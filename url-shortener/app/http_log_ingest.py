"""HTTP log shipper — same JSON payload as Kafka, for hosts without a broker (e.g. Railway)."""

from __future__ import annotations

import json
import logging
import os
import queue
import ssl
import threading
import urllib.error
import urllib.request

from app.kafka_logging import log_record_to_payload


class HttpLogIngestHandler(logging.Handler):
    """Background queue + POST to dashboard-backend `/api/ingest` (non-blocking emit)."""

    def __init__(self, url: str, token: str | None = None):
        super().__init__()
        self._url = url.strip().rstrip("/")
        self._token = (token or "").strip() or None
        self._instance_id = os.environ.get("INSTANCE_ID", "unknown")
        self._q: queue.Queue[dict] = queue.Queue(maxsize=8000)
        self._stop = threading.Event()
        self._failures = 0
        self._thread = threading.Thread(target=self._run, name="http-log-ingest", daemon=True)
        self._thread.start()

    def emit(self, record: logging.LogRecord) -> None:
        try:
            payload = log_record_to_payload(record, self._instance_id)
            if record.exc_info and record.exc_info[0] is not None:
                payload["exc_info"] = self.format(record) if self.formatter else str(record.exc_info)
            self._q.put_nowait(payload)
        except queue.Full:
            pass
        except Exception:
            if not getattr(self, "_emit_err", False):
                self._emit_err = True
                logging.getLogger(__name__).warning("HttpLogIngestHandler.emit failed", exc_info=True)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                item = self._q.get(timeout=0.5)
            except queue.Empty:
                continue
            self._post(item)

    def _post(self, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers = {"Content-Type": "application/json; charset=utf-8"}
        if self._token:
            headers["X-Log-Ingest-Token"] = self._token
        req = urllib.request.Request(self._url, data=data, method="POST", headers=headers)
        open_kw: dict = {"timeout": 15}
        # Public HTTPS (e.g. Railway *.up.railway.app); omit context for plain http:// private URLs.
        if self._url.lower().startswith("https://"):
            open_kw["context"] = ssl.create_default_context()
        try:
            with urllib.request.urlopen(req, **open_kw) as resp:
                if resp.status >= 400 and self._failures < 5:
                    self._failures += 1
                    print(f"[HttpLogIngestHandler] ingest HTTP {resp.status}", flush=True)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            self._failures += 1
            if self._failures <= 5:
                print(f"[HttpLogIngestHandler] ingest failed: {exc}", flush=True)

    def close(self) -> None:
        self._stop.set()
        super().close()
