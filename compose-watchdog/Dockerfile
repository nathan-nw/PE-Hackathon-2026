# syntax=docker/dockerfile:1
FROM python:3.13-alpine
RUN pip install --no-cache-dir docker==7.1.0
COPY watchdog.py /watchdog.py
# Root: Docker socket access (same pattern as mounting docker.sock into other ops containers).
CMD ["python", "/watchdog.py"]
