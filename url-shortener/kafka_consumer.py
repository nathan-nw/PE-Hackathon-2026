"""Kafka log consumer — subscribes to app-logs and prints to stdout."""

import json
import os
import sys
import time

from confluent_kafka import Consumer, KafkaError

BOOTSTRAP_SERVERS = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")
TOPIC = os.environ.get("KAFKA_LOG_TOPIC", "app-logs")
GROUP_ID = os.environ.get("KAFKA_CONSUMER_GROUP", "log-printer")

LEVEL_COLORS = {
    "DEBUG": "\033[36m",  # cyan
    "INFO": "\033[32m",  # green
    "WARNING": "\033[33m",  # yellow
    "ERROR": "\033[31m",  # red
    "CRITICAL": "\033[35m",  # magenta
}
RESET = "\033[0m"


def format_log(msg: dict) -> str:
    level = msg.get("level", "INFO")
    color = LEVEL_COLORS.get(level, "")
    ts = msg.get("timestamp", "")
    instance = msg.get("instance_id", "?")
    logger_name = msg.get("logger", "")
    message = msg.get("message", "")

    # Build extra context from request fields
    extras = []
    if "request_id" in msg:
        extras.append(f"req={msg['request_id']}")
    if "method" in msg and "path" in msg:
        extras.append(f"{msg['method']} {msg['path']}")
    if "status_code" in msg:
        extras.append(f"-> {msg['status_code']}")
    if "duration_ms" in msg:
        extras.append(f"({msg['duration_ms']}ms)")

    extra_str = " " + " ".join(extras) if extras else ""
    return f"{color}{ts} [{level}] instance={instance} {logger_name}: {message}{extra_str}{RESET}"


def main():
    print(f"[kafka-consumer] Connecting to {BOOTSTRAP_SERVERS}, topic={TOPIC}", flush=True)

    # Retry connection until Kafka is ready
    consumer = None
    for attempt in range(30):
        try:
            consumer = Consumer(
                {
                    "bootstrap.servers": BOOTSTRAP_SERVERS,
                    "group.id": GROUP_ID,
                    "auto.offset.reset": "latest",
                    "enable.auto.commit": True,
                }
            )
            consumer.subscribe([TOPIC])
            print(f"[kafka-consumer] Subscribed to {TOPIC}. Waiting for logs...", flush=True)
            break
        except Exception as exc:
            print(f"[kafka-consumer] Waiting for Kafka (attempt {attempt + 1}/30): {exc}", flush=True)
            time.sleep(2)

    if consumer is None:
        print("[kafka-consumer] Could not connect to Kafka after 30 attempts.", file=sys.stderr)
        sys.exit(1)

    try:
        while True:
            msg = consumer.poll(1.0)
            if msg is None:
                continue
            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    continue
                print(f"[kafka-consumer] Error: {msg.error()}", file=sys.stderr)
                continue
            try:
                payload = json.loads(msg.value().decode("utf-8"))
                print(format_log(payload), flush=True)
            except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                print(f"[kafka-consumer] Bad message: {exc}", file=sys.stderr)
    except KeyboardInterrupt:
        print("\n[kafka-consumer] Shutting down.", flush=True)
    finally:
        consumer.close()


if __name__ == "__main__":
    main()
