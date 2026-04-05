#!/usr/bin/env node
/**
 * Configure Railway services for this monorepo via the public GraphQL API:
 * https://docs.railway.com/integrations/api
 *
 * - Ensures Git-linked app services exist (same repo, different root directories):
 *   url-shortener-a, url-shortener-b, load-balancer, user-frontend, dashboard, dashboard-backend.
 * - Sets the deploy branch (default: feature-hosting) on each service's deployment trigger.
 * - Sets rootDirectory on each service instance for the environment in .railway/config.json.
 *
 * Auth: use an account API token from https://railway.com/account/tokens
 * (Authorization: Bearer). Project-scoped tokens often cannot create/link GitHub services.
 *
 * Usage (repo root):
 *   copy .env.railway.setup.example to .env.railway.setup and set RAILWAY_API_TOKEN
 *   node setup-railway.js
 *
 * Or: set RAILWAY_API_TOKEN=...   (or RAILWAY_TOKEN) in the shell.
 *
 * Optional env:
 *   RAILWAY_REPO=nathan-nw/PE-Hackathon-2026
 *   RAILWAY_BRANCH=feature-hosting
 *   DRY_RUN=1
 *   SKIP_REDEPLOY=1  — skip serviceInstanceDeploy after configuration
 *   FORCE_CLEAR_PREDEPLOY=1  — set preDeployCommand to [] even when already empty (rare)
 *   SYNC_VARIABLES=1  — upsert shared variable references (Postgres private URL, Redis, service URLs)
 *   SKIP_DEPLOY_ON_VARIABLE_SYNC=1  — pass skipDeploys to variableCollectionUpsert (default: true)
 *   RAILWAY_POSTGRES_SERVICE_NAME=Postgres  — plugin service name (default: Postgres)
 *   RAILWAY_REDIS_SERVICE_NAME=Redis  — plugin service name (default: Redis)
 *   RAILWAY_DASHBOARD_POSTGRES_SERVICE_NAME=…  — optional second Postgres plugin for dashboard_db only (mirrors compose service dashboard-db)
 *   RAILWAY_KAFKA_SERVICE_NAME=Kafka  — optional Kafka/Redpanda plugin; sets KAFKA_BOOTSTRAP_SERVERS on API + dashboard-backend
 *   RAILWAY_KAFKA_BOOTSTRAP_VAR=KAFKA_URL  — variable name on the Kafka service for the broker URL (template differs by provider)
 */

const fs = require("fs");
const path = require("path");

/** Load `.env.railway.setup` if present (does not override existing process.env). */
function loadOptionalEnvFile() {
  const p = path.join(__dirname, ".env.railway.setup");
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (let line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq <= 0) continue;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const ENDPOINT = "https://backboard.railway.com/graphql/v2";

const DEFAULT_REPO = "nathan-nw/PE-Hackathon-2026";
const DEFAULT_BRANCH = "feature-hosting";

/** @type {{ name: string, rootDirectory: string }[]} */
const APP_SERVICES = [
  // Same topology as docker-compose.yml: two API replicas + NGINX (least_conn, CORS, rate limit).
  { name: "url-shortener-a", rootDirectory: "url-shortener" },
  { name: "url-shortener-b", rootDirectory: "url-shortener" },
  { name: "load-balancer", rootDirectory: "load-balancer" },
  { name: "user-frontend", rootDirectory: "user-frontend" },
  { name: "dashboard", rootDirectory: "dashboard" },
  { name: "dashboard-backend", rootDirectory: "dashboard/backend" },
];

function loadRailwayConfig() {
  const p = path.join(__dirname, ".railway", "config.json");
  const raw = fs.readFileSync(p, "utf8");
  const j = JSON.parse(raw);
  if (!j.projectId || !j.environmentId) {
    throw new Error(`${p} must include projectId and environmentId`);
  }
  return { projectId: j.projectId, environmentId: j.environmentId };
}

function getAuthHeaders() {
  const account = process.env.RAILWAY_API_TOKEN || process.env.RAILWAY_TOKEN;
  const project = process.env.RAILWAY_PROJECT_TOKEN;
  if (account) {
    return { Authorization: `Bearer ${account}` };
  }
  if (project) {
    return { "Project-Access-Token": project };
  }
  throw new Error(
    "Set RAILWAY_API_TOKEN (or RAILWAY_TOKEN) to an account token from https://railway.com/account/tokens"
  );
}

async function gql(query, variables) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  }
  if (body.errors?.length) {
    const msg = body.errors.map((e) => e.message).join("; ");
    throw new Error(msg);
  }
  return body.data;
}

/** @returns {Map<string, { id: string, name: string, triggers: any[] }>} */
async function fetchServicesMap(projectId) {
  const data = await gql(Q_PROJECT, { id: projectId });
  const edges = data.project?.services?.edges || [];
  const byName = new Map();
  for (const e of edges) {
    const n = e.node;
    if (!n?.name) continue;
    const triggers = (n.repoTriggers?.edges || []).map((x) => x.node);
    byName.set(n.name, { id: n.id, name: n.name, triggers });
  }
  return byName;
}

const Q_PROJECT = `
  query ProjectServices($id: String!) {
    project(id: $id) {
      id
      name
      services(first: 100) {
        edges {
          node {
            id
            name
            repoTriggers(first: 20) {
              edges {
                node {
                  id
                  branch
                  repository
                  provider
                  environmentId
                }
              }
            }
          }
        }
      }
    }
  }
`;

const Q_SERVICE_INSTANCE = `
  query Si($environmentId: String!, $serviceId: String!) {
    serviceInstance(environmentId: $environmentId, serviceId: $serviceId) {
      id
      rootDirectory
      preDeployCommand
    }
  }
`;

const M_SERVICE_CREATE = `
  mutation Create($input: ServiceCreateInput!) {
    serviceCreate(input: $input) {
      id
      name
    }
  }
`;

const M_SERVICE_CONNECT = `
  mutation Connect($id: String!, $input: ServiceConnectInput!) {
    serviceConnect(id: $id, input: $input) {
      id
      name
    }
  }
`;

const M_TRIGGER_UPDATE = `
  mutation TriggerUpdate($id: String!, $input: DeploymentTriggerUpdateInput!) {
    deploymentTriggerUpdate(id: $id, input: $input) {
      id
      branch
      repository
    }
  }
`;

const M_INSTANCE_UPDATE = `
  mutation InstanceUpdate(
    $environmentId: String!
    $serviceId: String!
    $input: ServiceInstanceUpdateInput!
  ) {
    serviceInstanceUpdate(
      environmentId: $environmentId
      serviceId: $serviceId
      input: $input
    )
  }
`;

const M_DEPLOY_TRIGGER_CREATE = `
  mutation DeployTriggerCreate($input: DeploymentTriggerCreateInput!) {
    deploymentTriggerCreate(input: $input) {
      id
      branch
      repository
      serviceId
    }
  }
`;

/** Trigger a new deployment from the latest commit on the configured branch. */
const M_SERVICE_INSTANCE_DEPLOY = `
  mutation ServiceInstanceDeploy(
    $environmentId: String!
    $serviceId: String!
    $latestCommit: Boolean
  ) {
    serviceInstanceDeploy(
      environmentId: $environmentId
      serviceId: $serviceId
      latestCommit: $latestCommit
    )
  }
`;

const M_VARIABLE_COLLECTION_UPSERT = `
  mutation VariableCollectionUpsert($input: VariableCollectionUpsertInput!) {
    variableCollectionUpsert(input: $input)
  }
`;

/** Railway template: ${{ ServiceName.VARIABLE_NAME }} */
function varRef(serviceName, variableName) {
  return "${{ " + serviceName + "." + variableName + " }}";
}

/** Resolve plugin service names — dashboard may use "Postgres" or "postgresql" etc. */
function findPostgresServiceName(byName) {
  const explicit = (process.env.RAILWAY_POSTGRES_SERVICE_NAME || "").trim();
  if (explicit && byName.has(explicit)) return explicit;
  for (const c of ["Postgres", "postgres", "PostgreSQL", "postgresql"]) {
    if (byName.has(c)) return c;
  }
  for (const name of byName.keys()) {
    if (/postgres/i.test(name)) return name;
  }
  return null;
}

function findRedisServiceName(byName) {
  const explicit = (process.env.RAILWAY_REDIS_SERVICE_NAME || "").trim();
  if (explicit && byName.has(explicit)) return explicit;
  for (const c of ["Redis", "redis"]) {
    if (byName.has(c)) return c;
  }
  for (const name of byName.keys()) {
    if (/^redis$/i.test(name) || /redis/i.test(name)) return name;
  }
  return null;
}

/** Optional Kafka / Redpanda plugin — mirrors compose KAFKA_BOOTSTRAP_SERVERS. */
function findKafkaServiceName(byName) {
  const explicit = (process.env.RAILWAY_KAFKA_SERVICE_NAME || "").trim();
  if (explicit && byName.has(explicit)) return explicit;
  for (const c of ["Kafka", "kafka", "Redpanda", "redpanda"]) {
    if (byName.has(c)) return c;
  }
  for (const name of byName.keys()) {
    if (/kafka/i.test(name) || /redpanda/i.test(name)) return name;
  }
  return null;
}

/**
 * Optional second Postgres plugin for dashboard_db only (compose: service `dashboard-db` vs `db`).
 * If unset, dashboard-backend uses the same Postgres as url-shortener with DASHBOARD_DB_NAME=dashboard_db.
 */
function findDashboardPostgresServiceName(byName, primaryPostgres) {
  const explicit = (process.env.RAILWAY_DASHBOARD_POSTGRES_SERVICE_NAME || "").trim();
  if (explicit && byName.has(explicit)) return explicit;
  for (const name of byName.keys()) {
    if (name === primaryPostgres) continue;
    if (/dashboard/i.test(name) && /postgres/i.test(name)) return name;
  }
  const others = [...byName.keys()].filter(
    (n) => /postgres/i.test(n) && n !== primaryPostgres
  );
  if (others.length === 1) return others[0];
  return null;
}

/** Broker URL reference; variable name depends on the Kafka provider template on Railway. */
function kafkaBootstrapRef(kafkaServiceName) {
  const varName = (process.env.RAILWAY_KAFKA_BOOTSTRAP_VAR || "KAFKA_URL").trim() || "KAFKA_URL";
  return varRef(kafkaServiceName, varName);
}

/**
 * Aligns Railway env vars with docker-compose.yml service wiring (same keys / defaults where possible).
 * See RAILWAY.md → "Parity with Docker Compose".
 */
async function syncInternalDatabaseVariables(projectId, environmentId, byName, dry) {
  const postgresService = findPostgresServiceName(byName);
  const redisService = findRedisServiceName(byName);
  const kafkaService = findKafkaServiceName(byName);
  const usePublicDbUrl =
    process.env.SYNC_VARIABLES_USE_PUBLIC_DATABASE_URL === "1" ||
    process.env.SYNC_VARIABLES_USE_PUBLIC_DATABASE_URL === "true";
  // Railway Postgres plugins expose DATABASE_URL (private host) and DATABASE_PUBLIC_URL (TCP proxy).
  // DATABASE_PRIVATE_URL is not present on all templates — referencing it yields an empty DATABASE_URL on APIs.
  const dbUrlKey = usePublicDbUrl ? "DATABASE_PUBLIC_URL" : "DATABASE_URL";

  if (!postgresService) {
    console.warn(
      `\n(Variable sync) No Postgres-like service found in this project — add a PostgreSQL plugin or set RAILWAY_POSTGRES_SERVICE_NAME. Skipping DATABASE_* references.`
    );
    return;
  }
  console.log(`(Variable sync) Primary Postgres service: "${postgresService}"`);

  const dashboardPg = findDashboardPostgresServiceName(byName, postgresService);
  if (dashboardPg) {
    console.log(
      `(Variable sync) Dashboard Postgres (dashboard_db): separate plugin "${dashboardPg}" (compose: dashboard-db)`
    );
  } else {
    console.log(
      `(Variable sync) Dashboard DB: same Postgres as API + DASHBOARD_DB_NAME=dashboard_db (compose: second database on shared db)`
    );
  }

  const skipDeployOnVarSync =
    process.env.SKIP_DEPLOY_ON_VARIABLE_SYNC !== "0" &&
    process.env.SKIP_DEPLOY_ON_VARIABLE_SYNC !== "false";

  const upsert = async (serviceName, variables) => {
    const svc = byName.get(serviceName);
    if (!svc) {
      console.warn(`  (Variable sync) Service "${serviceName}" not found; skipping.`);
      return;
    }
    const keys = Object.keys(variables);
    console.log(`\n(Variable sync) ${serviceName}: ${keys.join(", ")}`);
    if (dry) return;
    await gql(M_VARIABLE_COLLECTION_UPSERT, {
      input: {
        projectId,
        environmentId,
        serviceId: svc.id,
        replace: false,
        skipDeploys: skipDeployOnVarSync,
        variables,
      },
    });
    console.log(`  variableCollectionUpsert OK`);
  };

  const pg = postgresService;
  const redis = redisService;
  const kafka = kafkaService;
  const pgDashboard = dashboardPg || pg;

  // url-shortener-a / url-shortener-b: same env as compose replicas (shared DB; distinct INSTANCE_ID).
  // Explicit PORT so ${{ url-shortener-a.PORT }} resolves on the load-balancer (runtime-only PORT is
  // not referenceable from other services — see Railway variables docs / Help Station).
  // Use 8080 to align with Railway’s common web port (Compose/local image default remains 5000 via Dockerfile).
  const urlShortenerBase = {
    PORT: "8080",
    DATABASE_URL: varRef(pg, dbUrlKey),
    FLASK_DEBUG: "false",
    KAFKA_LOG_TOPIC: "app-logs",
    ...(redis
      ? { RATE_LIMIT_STORAGE: varRef(redis, "REDIS_URL") }
      : { RATE_LIMIT_STORAGE: "memory://" }),
    ...(kafka ? { KAFKA_BOOTSTRAP_SERVERS: kafkaBootstrapRef(kafka) } : {}),
  };
  await upsert("url-shortener-a", { ...urlShortenerBase, INSTANCE_ID: "1" });
  await upsert("url-shortener-b", { ...urlShortenerBase, INSTANCE_ID: "2" });

  if (!redis) {
    console.warn(
      `(Variable sync) No Redis plugin — replicas use RATE_LIMIT_STORAGE=memory:// (same default as local url-shortener/.env.example; compose has no Redis).`
    );
  } else {
    console.log(`(Variable sync) Redis service: "${redis}"`);
  }

  if (!kafka) {
    console.warn(
      `(Variable sync) No Kafka-like service — KAFKA_BOOTSTRAP_SERVERS not set (compose uses kafka:9092; add a broker + RAILWAY_KAFKA_SERVICE_NAME if you want log shipping).`
    );
  } else {
    console.log(
      `(Variable sync) Kafka service: "${kafka}" (bootstrap var: ${process.env.RAILWAY_KAFKA_BOOTSTRAP_VAR || "KAFKA_URL"})`
    );
  }

  // NGINX load balancer: private hostnames for upstream (see load-balancer/docker-entrypoint.sh).
  if (
    byName.has("load-balancer") &&
    byName.has("url-shortener-a") &&
    byName.has("url-shortener-b")
  ) {
    await upsert("load-balancer", {
      URL_SHORTENER_A_HOST: varRef("url-shortener-a", "RAILWAY_PRIVATE_DOMAIN"),
      URL_SHORTENER_B_HOST: varRef("url-shortener-b", "RAILWAY_PRIVATE_DOMAIN"),
      // Gunicorn binds to Railway's PORT (synced above — typically 8080 on Railway).
      URL_SHORTENER_A_PORT: varRef("url-shortener-a", "PORT"),
      URL_SHORTENER_B_PORT: varRef("url-shortener-b", "PORT"),
    });
  } else if (byName.has("load-balancer")) {
    console.warn(
      `(Variable sync) load-balancer present but url-shortener-a / url-shortener-b missing — set URL_SHORTENER_*_HOST manually or run provisioning.`
    );
  }

  // dashboard-backend: mirrors compose dashboard-backend + dashboard-db
  const dashboardBackendVars = {
    DASHBOARD_DATABASE_URL: varRef(pgDashboard, dbUrlKey),
    DASHBOARD_DB_NAME: "dashboard_db",
    KAFKA_LOG_TOPIC: "app-logs",
    CACHE_MAX_ENTRIES: "1000",
    DB_FLUSH_INTERVAL: "30",
    ...(kafka ? { KAFKA_BOOTSTRAP_SERVERS: kafkaBootstrapRef(kafka) } : {}),
  };
  await upsert("dashboard-backend", dashboardBackendVars);

  if (byName.has("dashboard")) {
    await upsert("dashboard", {
      DASHBOARD_BACKEND_URL: "https://" + varRef("dashboard-backend", "RAILWAY_PUBLIC_DOMAIN"),
      VISIBILITY_K8S_ENABLED: "false",
      VISIBILITY_COMPOSE_PROJECT: "pe-hackathon-2026",
      // Ops tab: list services via Railway GraphQL (no Docker socket in the cloud).
      RAILWAY_PROJECT_ID: projectId,
      RAILWAY_ENVIRONMENT_ID: environmentId,
      VISIBILITY_ALERTMANAGER_DISABLED: "1",
      // Add RAILWAY_PROJECT_TOKEN or RAILWAY_API_TOKEN in the dashboard service manually (secret).
    });
  }

  if (byName.has("user-frontend")) {
    const apiPublic = byName.has("load-balancer")
      ? "https://" + varRef("load-balancer", "RAILWAY_PUBLIC_DOMAIN")
      : "https://" + varRef("url-shortener-a", "RAILWAY_PUBLIC_DOMAIN");
    await upsert("user-frontend", {
      NEXT_PUBLIC_API_URL: apiPublic,
    });
  }
}

function normalizeRepo(s) {
  const t = (s || "").trim();
  const m = t.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/i);
  return m ? m[1] : t;
}

async function main() {
  loadOptionalEnvFile();
  getAuthHeaders(); // fail fast if token missing
  const dry = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
  const repo = normalizeRepo(process.env.RAILWAY_REPO || DEFAULT_REPO);
  const branch = (process.env.RAILWAY_BRANCH || DEFAULT_BRANCH).trim();
  const { projectId, environmentId } = loadRailwayConfig();

  console.log(`Project: ${projectId}`);
  console.log(`Environment: ${environmentId}`);
  console.log(`Repo: ${repo}`);
  console.log(`Branch: ${branch}`);
  if (dry) console.log("(DRY_RUN: no mutations)");

  let byName = await fetchServicesMap(projectId);

  for (const spec of APP_SERVICES) {
    console.log(`\n--- ${spec.name} (${spec.rootDirectory}) ---`);
    let svc = byName.get(spec.name);

    if (!svc) {
      console.log("Service missing; would create + link repo");
      if (dry) continue;
      await gql(M_SERVICE_CREATE, {
        input: {
          projectId,
          environmentId,
          name: spec.name,
          branch,
          source: { repo },
        },
      });
      console.log(`Created service ${spec.name}`);
      byName = await fetchServicesMap(projectId);
      svc = byName.get(spec.name);
      if (!svc) throw new Error(`Service ${spec.name} not found after create`);
    }

    const triggers = svc.triggers.filter(
      (t) =>
        normalizeRepo(t.repository) === repo &&
        (!t.environmentId || t.environmentId === environmentId)
    );
    const anyTrigger = svc.triggers[0];

    if (triggers.length === 0) {
      if (anyTrigger && normalizeRepo(anyTrigger.repository) !== repo) {
        console.warn(
          `  Service is linked to a different repo (${anyTrigger.repository}). Skipping trigger branch update.`
        );
      } else if (!anyTrigger) {
        console.log("  No deployment trigger; connecting repo / creating trigger");
        if (!dry) {
          try {
            await gql(M_SERVICE_CONNECT, {
              id: svc.id,
              input: { repo, branch },
            });
            console.log("  serviceConnect OK");
          } catch (e) {
            console.log("  serviceConnect failed, trying deploymentTriggerCreate:", e.message);
            await gql(M_DEPLOY_TRIGGER_CREATE, {
              input: {
                projectId,
                environmentId,
                serviceId: svc.id,
                branch,
                repository: repo,
                provider: "GITHUB",
                rootDirectory: spec.rootDirectory,
              },
            });
            console.log("  deploymentTriggerCreate OK");
          }
          byName = await fetchServicesMap(projectId);
          svc = byName.get(spec.name);
        }
      }
    } else {
      for (const tr of triggers) {
        if (tr.branch === branch && normalizeRepo(tr.repository) === repo) {
          console.log(`  Trigger ${tr.id} already on ${branch}`);
          continue;
        }
        console.log(`  Updating trigger ${tr.id} -> branch ${branch}`);
        if (!dry) {
          await gql(M_TRIGGER_UPDATE, {
            id: tr.id,
            input: { branch, repository: repo, rootDirectory: spec.rootDirectory },
          });
        }
      }
    }

    // After create/connect, Railway may still use the repo default branch (e.g. main) until updated.
    if (!dry) {
      byName = await fetchServicesMap(projectId);
      svc = byName.get(spec.name);
      if (svc) {
        const trs = (svc.triggers || []).filter(
          (t) =>
            normalizeRepo(t.repository) === repo &&
            (!t.environmentId || t.environmentId === environmentId)
        );
        for (const tr of trs) {
          if (tr.branch !== branch) {
            console.log(`  Set trigger branch ${tr.id}: ${tr.branch} -> ${branch}`);
            await gql(M_TRIGGER_UPDATE, {
              id: tr.id,
              input: { branch, repository: repo, rootDirectory: spec.rootDirectory },
            });
          }
        }
      }
    }

    const si = await gql(Q_SERVICE_INSTANCE, {
      environmentId,
      serviceId: svc.id,
    });
    const curRoot = si.serviceInstance?.rootDirectory || "";
    const preRaw = si.serviceInstance?.preDeployCommand;
    const pre = Array.isArray(preRaw) ? preRaw : [];
    const forceClearPre =
      process.env.FORCE_CLEAR_PREDEPLOY === "1" ||
      process.env.FORCE_CLEAR_PREDEPLOY === "true";
    // Stale API state can keep a 2+ element list and break snapshot parsing ("at most 1 element")
    // even when the dashboard shows nothing and railway.toml has no preDeployCommand.
    const mustClearPre = forceClearPre || pre.length > 0;
    if (pre.length > 1) {
      console.warn(
        `  preDeployCommand has ${pre.length} entries (invalid; max 1). Clearing via API.`
      );
    } else if (pre.length === 1) {
      console.log(
        `  Clearing preDeployCommand (was ${JSON.stringify(pre)}); migrations run in Docker entrypoint.`
      );
    }

    const rootOk = curRoot === spec.rootDirectory;
    if (rootOk && !mustClearPre) {
      console.log(`  rootDirectory OK (${spec.rootDirectory})`);
    } else {
      if (rootOk) {
        console.log(`  rootDirectory OK (${spec.rootDirectory})`);
      } else {
        console.log(`  rootDirectory: "${curRoot}" -> "${spec.rootDirectory}"`);
      }
      const input = {};
      if (!rootOk) input.rootDirectory = spec.rootDirectory;
      if (mustClearPre) input.preDeployCommand = [];
      if (!dry) {
        await gql(M_INSTANCE_UPDATE, {
          environmentId,
          serviceId: svc.id,
          input,
        });
        console.log("  serviceInstanceUpdate OK");
      }
    }
  }

  const skipRedeploy =
    process.env.SKIP_REDEPLOY === "1" || process.env.SKIP_REDEPLOY === "true";
  if (!dry && !skipRedeploy) {
    console.log("\n--- Redeploy app services (latest commit) ---");
    byName = await fetchServicesMap(projectId);
    for (const spec of APP_SERVICES) {
      const svc = byName.get(spec.name);
      if (!svc) {
        console.warn(`  Skip ${spec.name}: not in project`);
        continue;
      }
      try {
        const deployData = await gql(M_SERVICE_INSTANCE_DEPLOY, {
          environmentId,
          serviceId: svc.id,
          latestCommit: true,
        });
        console.log(
          `  ${spec.name}: serviceInstanceDeploy OK (${deployData.serviceInstanceDeploy ?? "ok"})`
        );
      } catch (e) {
        console.warn(`  ${spec.name}: deploy failed — ${e.message}`);
      }
    }
  } else if (skipRedeploy && !dry) {
    console.log("\n(SKIP_REDEPLOY: not triggering redeploys)");
  }

  const syncVariables =
    process.env.SYNC_VARIABLES === "1" || process.env.SYNC_VARIABLES === "true";
  if (syncVariables) {
    console.log(
      "\n--- Variable sync (Docker Compose parity: Postgres, Redis, Kafka, app env) ---"
    );
    byName = await fetchServicesMap(projectId);
    await syncInternalDatabaseVariables(projectId, environmentId, byName, dry);
    if (!dry) {
      console.log(
        "\n(Create database dashboard_db in Postgres once if it does not exist — see RAILWAY.md.)"
      );
    }
  }

  console.log("\nDone. If GitHub linking failed, install the Railway GitHub app for the org/repo and retry.");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
