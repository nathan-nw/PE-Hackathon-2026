"""k6 load test runner — manages a single k6 subprocess at a time.

Spawns k6 with `--out json` to capture per-metric data points in real time,
then exposes live stats via get_status().
"""

import json
import logging
import os
import signal
import subprocess
import threading
import time
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

LOAD_TEST_SCRIPT = os.path.join(os.path.dirname(__file__), "load-test.js")

# Max VUs for each preset (must match stages in load-test.js)
PRESET_MAX_VUS = {
    "bronze": 50,
    "silver": 200,
    "gold": 500,
    "chaos": 100,
}


@dataclass
class K6Stats:
    """Live rolling stats parsed from k6 JSON output."""

    running: bool = False
    preset: str = ""
    vus: int = 0
    duration: str = ""
    target_url: str = ""
    started_at: float = 0.0
    elapsed_s: float = 0.0
    requests: int = 0
    errors: int = 0
    error_rate: float = 0.0
    avg_duration_ms: float = 0.0
    p95_duration_ms: float = 0.0
    current_vus: int = 0
    finished: bool = False
    summary: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "running": self.running,
            "preset": self.preset,
            "vus": self.vus,
            "duration": self.duration,
            "target_url": self.target_url,
            "started_at": self.started_at,
            "elapsed_s": round(time.time() - self.started_at, 1) if self.running else self.elapsed_s,
            "requests": self.requests,
            "errors": self.errors,
            "error_rate": round(self.error_rate, 4),
            "avg_duration_ms": round(self.avg_duration_ms, 2),
            "p95_duration_ms": round(self.p95_duration_ms, 2),
            "current_vus": self.current_vus,
            "finished": self.finished,
            "summary": self.summary,
        }


class K6Runner:
    """Manages a single k6 process. Thread-safe."""

    def __init__(self):
        self._proc: subprocess.Popen | None = None
        self._stats = K6Stats()
        self._lock = threading.Lock()
        self._reader_thread: threading.Thread | None = None
        self._durations: list[float] = []

    def start(
        self,
        preset: str = "",
        vus: int = 50,
        duration: str = "30s",
        target_url: str = "http://load-balancer:80",
    ) -> dict:
        with self._lock:
            if self._proc and self._proc.poll() is None:
                return {"error": "A test is already running. Stop it first."}

        env = os.environ.copy()
        env["K6_TARGET_URL"] = target_url

        if preset:
            env["K6_PRESET"] = preset.lower()
        else:
            env["K6_VUS"] = str(vus)
            env["K6_DURATION"] = duration
            env["K6_PRESET"] = ""

        cmd = ["k6", "run", "--out", "json=/dev/stderr", "--quiet", LOAD_TEST_SCRIPT]

        try:
            proc = subprocess.Popen(
                cmd,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        except FileNotFoundError:
            return {"error": "k6 binary not found. Rebuild the container with k6 installed."}

        # Resolve the correct max VUs for presets
        max_vus = PRESET_MAX_VUS.get(preset.lower(), vus) if preset else vus

        with self._lock:
            self._proc = proc
            self._durations = []
            self._stats = K6Stats(
                running=True,
                preset=preset,
                vus=max_vus,
                duration=duration,
                target_url=target_url,
                started_at=time.time(),
            )

        # Read JSON output in background thread
        self._reader_thread = threading.Thread(target=self._read_output, daemon=True)
        self._reader_thread.start()

        logger.info("k6 started: preset=%s vus=%d duration=%s target=%s", preset, vus, duration, target_url)
        return {"status": "started", "preset": preset, "vus": vus, "duration": duration}

    def stop(self) -> dict:
        with self._lock:
            if not self._proc or self._proc.poll() is not None:
                return {"status": "not_running"}
            try:
                self._proc.send_signal(signal.SIGINT)
                logger.info("Sent SIGINT to k6 (pid=%d)", self._proc.pid)
            except OSError as e:
                logger.warning("Failed to signal k6: %s", e)
                return {"error": str(e)}
        return {"status": "stopping"}

    def get_status(self) -> dict:
        with self._lock:
            # Check if process ended
            if self._proc and self._proc.poll() is not None and self._stats.running:
                self._stats.running = False
                self._stats.finished = True
                self._stats.elapsed_s = round(time.time() - self._stats.started_at, 1)
            return self._stats.to_dict()

    def _read_output(self):
        """Parse k6 JSON output lines from stderr to update live stats."""
        proc = self._proc
        if not proc or not proc.stderr:
            return

        for raw_line in proc.stderr:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line:
                continue

            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue

            metric_type = data.get("type")
            if metric_type != "Point":
                continue

            metric = data.get("metric", "")
            value = data.get("data", {}).get("value", 0)

            with self._lock:
                if metric == "http_reqs":
                    self._stats.requests += 1
                elif metric == "errors":
                    if value == 1:
                        self._stats.errors += 1
                    total = self._stats.requests or 1
                    self._stats.error_rate = self._stats.errors / total
                elif metric == "http_req_duration":
                    self._durations.append(value)
                    n = len(self._durations)
                    self._stats.avg_duration_ms = sum(self._durations) / n
                    if n >= 20:
                        sorted_d = sorted(self._durations)
                        p95_idx = int(n * 0.95)
                        self._stats.p95_duration_ms = sorted_d[min(p95_idx, n - 1)]
                elif metric == "vus":
                    self._stats.current_vus = int(value)

        # Process ended — read stdout for summary
        if proc.stdout:
            stdout = proc.stdout.read().decode("utf-8", errors="replace")
            if stdout.strip():
                with self._lock:
                    self._stats.summary["stdout"] = stdout.strip()

        with self._lock:
            self._stats.running = False
            self._stats.finished = True
            self._stats.elapsed_s = round(time.time() - self._stats.started_at, 1)

        logger.info("k6 finished: requests=%d errors=%d", self._stats.requests, self._stats.errors)
