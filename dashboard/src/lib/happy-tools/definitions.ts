import type OpenAI from "openai";

/** Tool definitions for the Happy ops agent (Chat Completions `tools`). */
export const HAPPY_TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_application_logs",
      description:
        "Fetch recent application HTTP/request logs from the Kafka-backed cache (and DB merge). Use for 'recent logs', filtering by level, status code, or text search.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Max rows (1–500, default 80)" },
          level: { type: "string", description: "Log level e.g. INFO, ERROR" },
          search: { type: "string", description: "Case-insensitive substring in message/path" },
          status_code: {
            type: "string",
            description: "HTTP status filter: single code, comma list, or 2xx/3xx/4xx/5xx",
          },
          instance_id: { type: "string" },
          source: {
            type: "string",
            enum: ["merged", "memory", "db"],
            description: "merged = ring buffer + Postgres (default)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_log_statistics",
      description:
        "Aggregate log stats: per-instance totals, global request/error counts, buffered rows (Ops dashboard cache).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_error_analytics",
      description:
        "Error-focused time buckets and recent error log lines (5xx, ERROR level, etc.) for the dashboard Error view.",
      parameters: {
        type: "object",
        properties: {
          window_minutes: { type: "integer", description: "1–1440, default 60" },
          log_limit: { type: "integer", description: "Max error rows (default 120)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_log_insights",
      description:
        "Per-minute request/error buckets plus merged log rows for charts (same filters as the Logs insights tab).",
      parameters: {
        type: "object",
        properties: {
          window_minutes: { type: "integer" },
          log_limit: { type: "integer" },
          level: { type: "string" },
          search: { type: "string" },
          status_code: { type: "string" },
          instance_id: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_backend_health",
      description: "FastAPI dashboard-backend health: Kafka, DB, ingest flags (reachability of log pipeline).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_golden_signals",
      description:
        "Latency and traffic time series derived from HTTP logs (golden signals / telemetry tab), not raw Prometheus.",
      parameters: {
        type: "object",
        properties: {
          range_minutes: { type: "integer", description: "1–1440, default 30" },
          step_seconds: { type: "integer", description: "5–300, default 15" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_flask_replica_stats",
      description:
        "Snapshots of Flask url-shortener replicas via load balancer /api/instance-stats (used for golden signals).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_postgres_introspection",
      description:
        "List databases and public tables visible to the dashboard (dashboard DB vs main app DB profiles).",
      parameters: {
        type: "object",
        properties: {
          profile: {
            type: "string",
            enum: ["default", "main"],
            description: "default = dashboard DB; main = app/url-shortener DB when configured",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_prometheus_alerts",
      description: "Active Alertmanager alerts (if enabled). Returns empty when alerting is disabled.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_docker_or_railway_visibility",
      description:
        "Compose Docker containers for this project, or Railway deployment rows when Railway tokens are set. Optional CPU/memory stats.",
      parameters: {
        type: "object",
        properties: {
          include_stats: { type: "boolean", description: "If true, fetch per-container CPU/memory (slower)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_incident_timeline",
      description: "Incident timeline events from the dashboard DB (newest first).",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer" },
          window_hours: { type: "integer" },
          event_type: { type: "string" },
          severity: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "k6_get_status",
      description: "Current k6 load test status, live stats if running, default target URL.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "k6_run_load_test",
      description: "Start a k6 load test against the configured target (load balancer / app URL).",
      parameters: {
        type: "object",
        properties: {
          preset: { type: "string", description: "Optional named preset from backend" },
          vus: { type: "integer", description: "Virtual users (default 50)" },
          duration: { type: "string", description: 'e.g. "30s", "1m"' },
          target_url: { type: "string", description: "Override URL; usually omit to use service default" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "k6_stop_load_test",
      description: "Stop the running k6 test.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "run_pytest",
      description:
        "Run Python tests via `uv run pytest` in a configured workspace. Only works when the host sets HAPPY_PYTEST_ENABLED and HAPPY_PYTEST_CWD (e.g. local dev).",
      parameters: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "pytest -k expression" },
          path: { type: "string", description: "Optional file or directory path relative to cwd" },
        },
      },
    },
  },
];
