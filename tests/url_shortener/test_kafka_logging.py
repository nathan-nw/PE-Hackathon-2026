"""Unit tests for Kafka logging handler and consumer formatting."""

from __future__ import annotations

import json
import logging
from unittest.mock import MagicMock, patch

import pytest

from app.kafka_logging import KafkaLogHandler


# ---------------------------------------------------------------------------
# KafkaLogHandler tests
# ---------------------------------------------------------------------------


class TestKafkaLogHandler:
    """Tests for KafkaLogHandler with a mocked Kafka producer."""

    @pytest.fixture()
    def mock_producer(self):
        producer = MagicMock()
        producer.produce = MagicMock()
        producer.poll = MagicMock()
        return producer

    @pytest.fixture()
    def handler(self, mock_producer):
        h = KafkaLogHandler(bootstrap_servers="localhost:9092", topic="test-logs")
        h._producer = mock_producer
        return h

    def test_emit_produces_json_message(self, handler, mock_producer):
        record = logging.LogRecord(
            name="test.logger",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="hello world",
            args=None,
            exc_info=None,
        )
        handler.emit(record)

        mock_producer.produce.assert_called_once()
        call_args = mock_producer.produce.call_args
        assert call_args[0][0] == "test-logs"

        raw = call_args[1]["value"]
        payload = json.loads(raw.decode("utf-8"))
        assert payload["level"] == "INFO"
        assert payload["logger"] == "test.logger"
        assert payload["message"] == "hello world"
        assert "timestamp" in payload

    def test_emit_includes_request_extras(self, handler, mock_producer):
        record = logging.LogRecord(
            name="app.middleware",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="http_request",
            args=None,
            exc_info=None,
        )
        record.request_id = "abc123"
        record.method = "GET"
        record.path = "/health"
        record.status_code = 200
        record.duration_ms = 12.5

        handler.emit(record)

        raw = mock_producer.produce.call_args[0][1] if len(mock_producer.produce.call_args[0]) > 1 else mock_producer.produce.call_args[1]["value"]
        payload = json.loads(raw.decode("utf-8"))
        assert payload["request_id"] == "abc123"
        assert payload["method"] == "GET"
        assert payload["path"] == "/health"
        assert payload["status_code"] == 200
        assert payload["duration_ms"] == 12.5

    def test_emit_includes_instance_id(self, handler, mock_producer):
        with patch.dict("os.environ", {"INSTANCE_ID": "42"}):
            h = KafkaLogHandler(bootstrap_servers="localhost:9092")
            h._producer = mock_producer

        record = logging.LogRecord(
            name="test", level=logging.INFO, pathname="", lineno=0,
            msg="test", args=None, exc_info=None,
        )
        h.emit(record)

        raw = mock_producer.produce.call_args[0][1] if len(mock_producer.produce.call_args[0]) > 1 else mock_producer.produce.call_args[1]["value"]
        payload = json.loads(raw.decode("utf-8"))
        assert payload["instance_id"] == "42"

    def test_emit_never_raises(self, handler, mock_producer):
        mock_producer.produce.side_effect = RuntimeError("Kafka down")
        record = logging.LogRecord(
            name="test", level=logging.ERROR, pathname="", lineno=0,
            msg="should not crash", args=None, exc_info=None,
        )
        # Should not raise
        handler.emit(record)

    def test_emit_skips_when_producer_unavailable(self):
        handler = KafkaLogHandler(bootstrap_servers="localhost:9092")
        handler._failed = True

        record = logging.LogRecord(
            name="test", level=logging.INFO, pathname="", lineno=0,
            msg="skip me", args=None, exc_info=None,
        )
        # Should silently return without error
        handler.emit(record)

    def test_lazy_producer_creation_on_failure(self):
        handler = KafkaLogHandler(bootstrap_servers="bad:9092")
        with patch("app.kafka_logging.KafkaLogHandler._get_producer", return_value=None):
            record = logging.LogRecord(
                name="test", level=logging.INFO, pathname="", lineno=0,
                msg="no producer", args=None, exc_info=None,
            )
            handler.emit(record)
            # No crash, no produce call

    def test_polls_after_produce(self, handler, mock_producer):
        record = logging.LogRecord(
            name="test", level=logging.INFO, pathname="", lineno=0,
            msg="poll test", args=None, exc_info=None,
        )
        handler.emit(record)
        mock_producer.poll.assert_called_once_with(0)


# ---------------------------------------------------------------------------
# configure_logging integration test
# ---------------------------------------------------------------------------


class TestConfigureLogging:
    def test_adds_kafka_handler_when_env_set(self):
        with patch.dict("os.environ", {"KAFKA_BOOTSTRAP_SERVERS": "kafka:9092"}):
            with patch("app.kafka_logging.KafkaLogHandler") as MockHandler:
                from app.logging_config import configure_logging

                root = logging.getLogger()
                original_handlers = list(root.handlers)

                configure_logging()

                MockHandler.assert_called_once_with(bootstrap_servers="kafka:9092")

                # Cleanup: restore original handlers
                root.handlers = original_handlers

    def test_no_kafka_handler_without_env(self):
        with patch.dict("os.environ", {}, clear=False):
            import os
            os.environ.pop("KAFKA_BOOTSTRAP_SERVERS", None)

            from app.logging_config import configure_logging

            root = logging.getLogger()
            original_handlers = list(root.handlers)

            configure_logging()

            kafka_handlers = [
                h for h in root.handlers if type(h).__name__ == "KafkaLogHandler"
            ]
            assert len(kafka_handlers) == 0

            # Cleanup
            root.handlers = original_handlers


# ---------------------------------------------------------------------------
# format_log tests (consumer side)
# ---------------------------------------------------------------------------


class TestFormatLog:
    @pytest.fixture(autouse=True)
    def _import_format_log(self):
        # Import from the standalone consumer script
        import importlib.util
        import os

        spec = importlib.util.spec_from_file_location(
            "kafka_consumer",
            os.path.join(os.path.dirname(__file__), "..", "..", "url-shortener", "kafka_consumer.py"),
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.format_log = mod.format_log
        self.RESET = mod.RESET

    def test_basic_log_formatting(self):
        msg = {
            "timestamp": "2026-04-04T10:00:00Z",
            "level": "INFO",
            "instance_id": "1",
            "logger": "app.middleware",
            "message": "hello",
        }
        result = self.format_log(msg)
        assert "2026-04-04T10:00:00Z" in result
        assert "[INFO]" in result
        assert "instance=1" in result
        assert "app.middleware" in result
        assert "hello" in result

    def test_request_fields_included(self):
        msg = {
            "timestamp": "2026-04-04T10:00:00Z",
            "level": "INFO",
            "instance_id": "2",
            "logger": "app.middleware",
            "message": "http_request",
            "request_id": "abc123",
            "method": "GET",
            "path": "/health",
            "status_code": 200,
            "duration_ms": 5.2,
        }
        result = self.format_log(msg)
        assert "req=abc123" in result
        assert "GET /health" in result
        assert "-> 200" in result
        assert "(5.2ms)" in result

    def test_error_level_coloring(self):
        msg = {
            "timestamp": "2026-04-04T10:00:00Z",
            "level": "ERROR",
            "instance_id": "1",
            "logger": "test",
            "message": "fail",
        }
        result = self.format_log(msg)
        assert "\033[31m" in result  # red
        assert result.endswith(self.RESET)

    def test_missing_fields_use_defaults(self):
        result = self.format_log({})
        assert "[INFO]" in result
        assert "instance=?" in result

    def test_partial_request_fields(self):
        msg = {
            "level": "WARNING",
            "message": "slow",
            "method": "POST",
            "path": "/shorten",
        }
        result = self.format_log(msg)
        assert "POST /shorten" in result
        assert "req=" not in result  # no request_id
