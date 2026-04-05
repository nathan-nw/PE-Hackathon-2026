/**
 * Railway GraphQL (same API as the Railway dashboard).
 * Used when the app runs on Railway: there is no /var/run/docker.sock.
 *
 * Auth: account token (Authorization: Bearer) or project token (Project-Access-Token).
 * @see https://docs.railway.com/reference/public-api
 */

import {
  getRailwayGraphqlAuthHeaders,
  hasRailwayGraphqlCredential,
  runtimeEnv,
} from "./server-runtime-env";

const ENDPOINT = "https://backboard.railway.com/graphql/v2";

/**
 * Railway dashboard–style lifecycle (deployment active vs stopped vs in flight).
 * Maps from `DeploymentStatus` + whether a deployment row exists.
 */
export type RailwayOnlineStatus =
  | "online"
  | "completed"
  | "deploying"
  | "failed"
  | "skipped"
  | "unknown"
  /** Liveness probes failed repeatedly while deployment still reports SUCCESS (wedged); mirrors Docker `exited`. */
  | "exited";

export type RailwayVisibilityRow = {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  /** Raw Railway deployment status (e.g. SUCCESS, CRASHED, DEPLOYING). */
  deploymentStatus?: string;
  /** Hosted UI: Online ≈ running deployment, Completed ≈ stopped/no deployment, Deploying ≈ build/rollout. */
  railwayOnlineStatus: RailwayOnlineStatus;
  service: string;
  health?: string;
  created: number;
  railwayServiceId: string;
  railwayDeploymentId?: string;
  railwayPublicUrl?: string;
  /** From Railway metrics API when `includeStats` (same units as Docker rows for the Ops table). */
  cpuPercent?: number;
  memUsage?: number;
  memLimit?: number;
};

type GqlResponse<T> = { data?: T; errors?: { message: string }[] };

export async function railwayGraphql<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getRailwayGraphqlAuthHeaders(),
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as GqlResponse<T>;
  if (!res.ok) {
    throw new Error(`Railway API HTTP ${res.status}`);
  }
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join("; "));
  }
  if (!body.data) {
    throw new Error("Railway API returned no data");
  }
  return body.data;
}

/** @internal Alias for historical call sites in this file. */
const gql = railwayGraphql;

/** Map Railway `DeploymentStatus` to Docker-like state + optional health hint for the Ops UI. */
export function deploymentStatusToState(status: string): {
  state: string;
  health?: string;
} {
  const s = (status || "").trim().toUpperCase();
  if (!s || s === "UNKNOWN") {
    return { state: "unknown", health: undefined };
  }

  if (s === "SUCCESS") {
    return { state: "running", health: "healthy" };
  }
  if (s === "SLEEPING") {
    return { state: "running", health: undefined };
  }

  if (
    s === "BUILDING" ||
    s === "DEPLOYING" ||
    s === "INITIALIZING" ||
    s === "NEEDS_APPROVAL" ||
    s === "QUEUED" ||
    s === "WAITING" ||
    s === "REMOVING" ||
    s === "THROTTLED"
  ) {
    return { state: "running", health: "starting" };
  }

  if (s === "FAILED" || s === "CRASHED") {
    return { state: "exited", health: "unhealthy" };
  }
  if (s === "REMOVED") {
    return { state: "dead", health: undefined };
  }
  if (s === "STOPPED" || s === "CANCELED" || s === "CANCELLED") {
    return { state: "exited", health: undefined };
  }
  if (s === "SKIPPED") {
    return { state: "skipped", health: undefined };
  }

  return { state: "unknown", health: undefined };
}

/** Railway UI labels: Online / Completed / Deploying — aligned with dashboard deployment lifecycle. */
export function deploymentStatusToRailwayUi(
  deploymentStatus: string | undefined,
  hasActiveDeployment: boolean
): RailwayOnlineStatus {
  if (!hasActiveDeployment) {
    return "completed";
  }
  const s = (deploymentStatus ?? "").trim().toUpperCase();
  if (!s || s === "UNKNOWN") {
    return "unknown";
  }

  if (s === "SUCCESS" || s === "SLEEPING") {
    return "online";
  }
  if (
    s === "BUILDING" ||
    s === "DEPLOYING" ||
    s === "INITIALIZING" ||
    s === "NEEDS_APPROVAL" ||
    s === "QUEUED" ||
    s === "WAITING" ||
    s === "REMOVING" ||
    s === "THROTTLED"
  ) {
    return "deploying";
  }
  if (s === "FAILED" || s === "CRASHED") {
    return "failed";
  }
  if (s === "REMOVED" || s === "STOPPED" || s === "CANCELED" || s === "CANCELLED") {
    return "completed";
  }
  if (s === "SKIPPED") {
    return "skipped";
  }
  return "unknown";
}

const Q_PROJECT_SERVICES = `
  query ProjectServicesRailway($id: String!) {
    project(id: $id) {
      id
      name
      services(first: 100) {
        edges {
          node {
            id
            name
          }
        }
      }
    }
  }
`;

type ProjectServicesData = {
  project: {
    id: string;
    name: string;
    services: {
      edges: { node: { id: string; name: string } | null }[];
    };
  } | null;
};

type DeploymentsBatch = Record<
  string,
  {
    edges: {
      node: {
        id: string;
        status: string;
        createdAt?: string;
        url?: string | null;
        staticUrl?: string | null;
      };
    }[];
  } | null
>;

/**
 * One GraphQL request with aliases — `deployments(input: { projectId, environmentId, serviceId })`
 * is documented on Railway Help; avoids relying on ServiceInstance-only fields.
 * @see https://station.railway.com/questions/help-using-railway-api-6778e043
 */
function buildBatchDeploymentsQuery(
  projectId: string,
  environmentId: string,
  serviceIds: string[]
): { query: string; aliasKeys: string[] } {
  const aliasKeys: string[] = [];
  const parts = serviceIds.map((sid, i) => {
    const key = `d${i}`;
    aliasKeys.push(key);
    return `
    ${key}: deployments(first: 1, input: { projectId: "${projectId}", environmentId: "${environmentId}", serviceId: "${sid}" }) {
      edges {
        node {
          id
          status
          createdAt
          url
          staticUrl
        }
      }
    }`;
  });
  const query = `query RailwayDeployments { ${parts.join("\n")} }`;
  return { query, aliasKeys };
}

const Q_ENV_METRICS = `
  query RailwayEnvMetrics(
    $environmentId: String!
    $startDate: DateTime!
    $measurements: [MetricMeasurement!]!
    $groupBy: [MetricTag!]
  ) {
    metrics(
      environmentId: $environmentId
      startDate: $startDate
      measurements: $measurements
      groupBy: $groupBy
    ) {
      measurement
      tags {
        serviceId
      }
      values {
        ts
        value
      }
    }
  }
`;

type MetricsQueryData = {
  metrics: {
    measurement: string;
    tags: { serviceId?: string | null } | null;
    values: { ts: string; value: number }[] | null;
  }[] | null;
};

type ServiceMetricAcc = {
  cpuUsage?: number;
  cpuLimit?: number;
  memUsageGb?: number;
  memLimitGb?: number;
};

function latestMetricValue(
  values: { ts: string; value: number }[] | null | undefined
): number | undefined {
  if (!values?.length) return undefined;
  let best = values[0]!;
  let bestT = new Date(best.ts).getTime();
  for (let i = 1; i < values.length; i++) {
    const v = values[i]!;
    const t = new Date(v.ts).getTime();
    if (t >= bestT) {
      bestT = t;
      best = v;
    }
  }
  return best.value;
}

/**
 * Latest CPU/memory per service from Railway observability (GraphQL `metrics`).
 * Requires the same token scope as other project queries.
 */
async function fetchRailwayServiceMetricsByServiceId(
  environmentId: string
): Promise<Map<string, ServiceMetricAcc>> {
  const out = new Map<string, ServiceMetricAcc>();
  const startDate = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  let data: MetricsQueryData;
  try {
    data = await gql<MetricsQueryData>(Q_ENV_METRICS, {
      environmentId,
      startDate,
      measurements: [
        "CPU_USAGE",
        "CPU_LIMIT",
        "MEMORY_USAGE_GB",
        "MEMORY_LIMIT_GB",
      ],
      groupBy: ["SERVICE_ID"],
    });
  } catch {
    return out;
  }

  const rows = data.metrics;
  if (!rows?.length) return out;

  for (const row of rows) {
    const sid = row.tags?.serviceId;
    if (!sid) continue;
    let acc = out.get(sid);
    if (!acc) {
      acc = {};
      out.set(sid, acc);
    }
    const v = latestMetricValue(row.values ?? undefined);
    if (v == null || Number.isNaN(v)) continue;
    const m = row.measurement;
    if (m === "CPU_USAGE") acc.cpuUsage = v;
    else if (m === "CPU_LIMIT") acc.cpuLimit = v;
    else if (m === "MEMORY_USAGE_GB") acc.memUsageGb = v;
    else if (m === "MEMORY_LIMIT_GB") acc.memLimitGb = v;
  }

  return out;
}

function applyRailwayMetricsToRows(
  rows: RailwayVisibilityRow[],
  byService: Map<string, ServiceMetricAcc>
): RailwayVisibilityRow[] {
  const gb = 1024 ** 3;
  return rows.map((row) => {
    const acc = byService.get(row.railwayServiceId);
    if (!acc) return row;

    let cpuPercent: number | undefined;
    if (
      acc.cpuUsage != null &&
      acc.cpuLimit != null &&
      acc.cpuLimit > 0
    ) {
      cpuPercent = (acc.cpuUsage / acc.cpuLimit) * 100;
    }

    let memUsage: number | undefined;
    let memLimit: number | undefined;
    if (acc.memUsageGb != null) memUsage = acc.memUsageGb * gb;
    if (acc.memLimitGb != null) memLimit = acc.memLimitGb * gb;

    return {
      ...row,
      ...(cpuPercent != null ? { cpuPercent } : {}),
      ...(memUsage != null ? { memUsage } : {}),
      ...(memLimit != null ? { memLimit } : {}),
    };
  });
}

export function railwayIdsConfigured(): boolean {
  return Boolean(
    runtimeEnv("RAILWAY_PROJECT_ID") && runtimeEnv("RAILWAY_ENVIRONMENT_ID")
  );
}

export function railwayVisibilityConfigured(): boolean {
  return railwayIdsConfigured() && hasRailwayGraphqlCredential();
}

export async function fetchRailwayVisibilityRows(options?: {
  includeStats?: boolean;
}): Promise<{
  project: string;
  projectId: string;
  containers: RailwayVisibilityRow[];
  error?: string;
}> {
  const projectId = runtimeEnv("RAILWAY_PROJECT_ID")!;
  const environmentId = runtimeEnv("RAILWAY_ENVIRONMENT_ID")!;

  let projectName = projectId;
  let services: { id: string; name: string }[] = [];

  try {
    const proj = await gql<ProjectServicesData>(Q_PROJECT_SERVICES, { id: projectId });
    if (!proj.project) {
      return {
        project: projectName,
        projectId,
        containers: [],
        error: "Railway project not found (check RAILWAY_PROJECT_ID)",
      };
    }
    projectName = proj.project.name || projectId;
    services = (proj.project.services.edges || [])
      .map((e) => e.node)
      .filter(Boolean) as { id: string; name: string }[];
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Railway project query failed";
    return { project: projectName, projectId, containers: [], error: msg };
  }

  if (services.length === 0) {
    return { project: projectName, projectId, containers: [] };
  }

  const { query, aliasKeys } = buildBatchDeploymentsQuery(
    projectId,
    environmentId,
    services.map((s) => s.id)
  );

  let batch: DeploymentsBatch;
  try {
    batch = await gql<DeploymentsBatch>(query);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Railway deployments query failed";
    return { project: projectName, projectId, containers: [], error: msg };
  }

  const byId = new Map(services.map((s) => [s.id, s.name]));
  const rows: RailwayVisibilityRow[] = [];

  for (let i = 0; i < services.length; i++) {
    const sid = services[i].id;
    const key = aliasKeys[i];
    const conn = batch[key];
    const dep = conn?.edges?.[0]?.node;

    if (!dep) {
      rows.push({
        id: `service:${sid}`,
        name: byId.get(sid) || sid,
        image: "Railway",
        state: "exited",
        status: "No active deployment",
        deploymentStatus: undefined,
        railwayOnlineStatus: deploymentStatusToRailwayUi(undefined, false),
        service: byId.get(sid) || "",
        health: undefined,
        created: 0,
        railwayServiceId: sid,
        railwayDeploymentId: undefined,
        railwayPublicUrl: undefined,
      });
      continue;
    }

    const status = dep.status ?? "UNKNOWN";
    const { state, health } = deploymentStatusToState(status);
    const railwayOnlineStatus = deploymentStatusToRailwayUi(status, true);

    const createdSec = dep.createdAt
      ? Math.floor(new Date(dep.createdAt).getTime() / 1000)
      : 0;

    const publicUrl = dep.staticUrl || dep.url || undefined;

    rows.push({
      id: dep.id,
      name: byId.get(sid) || sid,
      image: "Railway",
      state,
      status: `${status}${publicUrl ? ` · ${publicUrl}` : ""}`,
      deploymentStatus: status,
      railwayOnlineStatus,
      service: byId.get(sid) || "",
      health,
      created: createdSec,
      railwayServiceId: sid,
      railwayDeploymentId: dep.id,
      railwayPublicUrl: publicUrl ?? undefined,
    });
  }

  const includeStats = Boolean(options?.includeStats);
  if (includeStats && rows.length > 0) {
    const byService = await fetchRailwayServiceMetricsByServiceId(environmentId);
    return {
      project: projectName,
      projectId,
      containers: applyRailwayMetricsToRows(rows, byService),
    };
  }

  return { project: projectName, projectId, containers: rows };
}

const M_DEPLOYMENT_RESTART = `
  mutation DeploymentRestart($id: String!) {
    deploymentRestart(id: $id)
  }
`;

const M_DEPLOYMENT_STOP = `
  mutation DeploymentStop($id: String!) {
    deploymentStop(id: $id)
  }
`;

const M_DEPLOYMENT_REMOVE = `
  mutation DeploymentRemove($id: String!) {
    deploymentRemove(id: $id)
  }
`;

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

/** Restart the running deployment (graceful reboot), same idea as `docker restart`. */
export async function railwayDeploymentRestart(deploymentId: string): Promise<void> {
  const data = await railwayGraphql<{ deploymentRestart?: boolean | null }>(
    M_DEPLOYMENT_RESTART,
    {
      id: deploymentId,
    }
  );
  if (data.deploymentRestart === false) {
    throw new Error(
      "Railway deploymentRestart returned false — check token permissions and deployment state."
    );
  }
}

/** Set `CHAOS_RAILWAY_LOG=0` on the dashboard service to silence chaos Railway logs. */
export function railwayChaosLog(
  event: string,
  data: Record<string, unknown>
): void {
  if (runtimeEnv("CHAOS_RAILWAY_LOG") === "0") return;
  console.info(`[dashboard][railway-chaos] ${event}`, data);
}

/**
 * Halt the active deployment (Chaos Kill on hosted Railway).
 * Tries `deploymentStop` first, then `deploymentRemove` if stop fails, returns false, or returns null
 * (some tokens/API versions return null on success; remove is the reliable teardown for “kill”).
 */
export async function railwayChaosHaltDeployment(
  deploymentId: string
): Promise<{ method: "deploymentStop" | "deploymentRemove" }> {
  const idShort = `${deploymentId.slice(0, 10)}…`;
  railwayChaosLog("halt:begin", { deploymentId: idShort });

  let stopErr: Error | undefined;
  let stopResult: boolean | null | undefined;

  try {
    const data = await railwayGraphql<{ deploymentStop?: boolean | null }>(
      M_DEPLOYMENT_STOP,
      { id: deploymentId }
    );
    stopResult = data.deploymentStop;
    railwayChaosLog("halt:deploymentStop_response", {
      deploymentId: idShort,
      deploymentStop: stopResult === undefined ? "undefined" : stopResult,
    });
    if (stopResult === true) {
      return { method: "deploymentStop" };
    }
  } catch (e) {
    stopErr = e instanceof Error ? e : new Error(String(e));
    railwayChaosLog("halt:deploymentStop_error", {
      deploymentId: idShort,
      message: stopErr.message,
    });
  }

  if (stopResult === false) {
    railwayChaosLog("halt:deploymentStop_false_try_remove", {
      deploymentId: idShort,
    });
  } else if (!stopErr && stopResult !== true) {
    railwayChaosLog("halt:deploymentStop_not_true_try_remove", {
      deploymentId: idShort,
      deploymentStop: stopResult === undefined ? "undefined" : stopResult,
    });
  }

  try {
    const data2 = await railwayGraphql<{ deploymentRemove?: boolean | null }>(
      M_DEPLOYMENT_REMOVE,
      { id: deploymentId }
    );
    railwayChaosLog("halt:deploymentRemove_response", {
      deploymentId: idShort,
      deploymentRemove:
        data2.deploymentRemove === undefined ? "undefined" : data2.deploymentRemove,
    });
    if (data2.deploymentRemove === false) {
      throw new Error("deploymentRemove returned false");
    }
    return { method: "deploymentRemove" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    railwayChaosLog("halt:deploymentRemove_error", {
      deploymentId: idShort,
      message: msg,
    });
    if (stopErr) {
      throw new Error(
        `Railway halt failed: deploymentStop (${stopErr.message}); deploymentRemove (${msg})`
      );
    }
    throw new Error(
      `Railway halt failed: deploymentStop did not return true; deploymentRemove (${msg})`
    );
  }
}

/** Redeploy latest commit — used by the Railway watchdog to recover after stop/crash. */
export async function railwayServiceInstanceDeployLatest(
  environmentId: string,
  serviceId: string
): Promise<void> {
  await railwayGraphql<{ serviceInstanceDeploy: boolean }>(
    M_SERVICE_INSTANCE_DEPLOY,
    {
      environmentId,
      serviceId,
      latestCommit: true,
    }
  );
}

/** Resolve a service row for chaos actions (server-side validation). */
export async function getRailwayChaosRowForService(
  railwayServiceId: string
): Promise<RailwayVisibilityRow | null> {
  const r = await fetchRailwayVisibilityRows({ includeStats: false });
  if (r.error) return null;
  return r.containers.find((c) => c.railwayServiceId === railwayServiceId) ?? null;
}
