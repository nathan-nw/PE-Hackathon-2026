"""Background Kafka consumer that feeds the log cache."""

from __future__ import annotations

import json
import logging
import time

from confluent_kafka import Consumer, KafkaError

from cache import LogCache
from discord_alerter import DiscordAlerter

logger = logging.getLogger(__name__)


def run_consumer(
    cache: LogCache,
    bootstrap_servers: str,
    topic: str,
    group_id: str = "dashboard-cache",
    alerter: DiscordAlerter | None = None,
) -> None:
    """Blocking loop: consume from Kafka and write into the cache.

    Intended to run in a background thread started by the FastAPI lifespan.
    """
    consumer = None
    for attempt in range(30):
        try:
            consumer = Consumer({
                "bootstrap.servers": bootstrap_servers,
                "group.id": group_id,
                "auto.offset.reset": "latest",
                "enable.auto.commit": True,
            })
            consumer.subscribe([topic])
            logger.info("Subscribed to %s at %s", topic, bootstrap_servers)
            break
        except Exception as exc:
            logger.warning("Waiting for Kafka (attempt %d/30): %s", attempt + 1, exc)
            time.sleep(2)

    if consumer is None:
        logger.error("Could not connect to Kafka after 30 attempts")
        return

    try:
        while True:
            msg = consumer.poll(1.0)
            if msg is None:
                continue
            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    continue
                logger.error("Kafka error: %s", msg.error())
                continue
            try:
                payload = json.loads(msg.value().decode("utf-8"))
                cache.add(payload)
                if alerter:
                    alerter.maybe_alert(payload)
            except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                logger.warning("Skipping bad message: %s", exc)
    except Exception as exc:
        logger.error("Consumer crashed: %s", exc)
    finally:
        consumer.close()
