"""Tests that HTTP log shipper sends Kafka-shaped JSON to dashboard-backend (Railway path)."""

from __future__ import annotations

import json
import logging
import os
import time
from unittest.mock import MagicMock, patch


from app.http_log_ingest import HttpLogIngestHandler


class TestHttpLogIngestHandler:
    def test_posts_json_with_token_header(self):
        captured: dict = {}

        def fake_urlopen(req, *args, **kwargs):
            captured["url"] = req.full_url
            captured["headers"] = {k: v for k, v in req.header_items()}
            captured["data"] = req.data
            mock_resp = MagicMock()
            mock_resp.status = 200
            cm = MagicMock()
            cm.__enter__ = lambda s: mock_resp
            cm.__exit__ = lambda *a: False
            return cm

        with patch.dict(
            os.environ,
            {"INSTANCE_ID": "7", "LOG_INGEST_TOKEN": "my-secret"},
            clear=False,
        ):
            h = HttpLogIngestHandler(
                url="https://example.up.railway.app/api/ingest",
                token="my-secret",
            )
            record = logging.LogRecord(
                name="app.middleware",
                level=logging.INFO,
                pathname="",
                lineno=0,
                msg="GET /x -> 200",
                args=(),
                exc_info=None,
            )
            record.request_id = "rid1"
            record.method = "GET"
            record.path = "/x"
            record.status_code = 200
            record.duration_ms = 3.14

            with patch("urllib.request.urlopen", side_effect=fake_urlopen):
                h.emit(record)
                time.sleep(0.6)
                h.close()

        assert "example.up.railway.app" in captured["url"]
        hdrs = {k.lower(): v for k, v in captured["headers"].items()}
        assert hdrs.get("x-log-ingest-token") == "my-secret"
        body = json.loads(captured["data"].decode("utf-8"))
        assert body["instance_id"] == "7"
        assert body["path"] == "/x"
        assert body["status_code"] == 200

    def test_configure_logging_adds_http_handler_when_ingest_url_set(self):
        env = {
            "KAFKA_BOOTSTRAP_SERVERS": "",
            "LOG_INGEST_URL": "https://backend.example/api/ingest",
            "LOG_INGEST_TOKEN": "tok",
        }
        with patch.dict(os.environ, env, clear=False):
            from app.logging_config import configure_logging

            root = logging.getLogger()
            saved = list(root.handlers)
            try:
                configure_logging()
                names = [type(x).__name__ for x in root.handlers]
                assert "HttpLogIngestHandler" in names
            finally:
                root.handlers = saved
