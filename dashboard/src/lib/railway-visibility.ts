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
} from "@/lib/server-runtime-env";

const ENDPOINT = "https://backboard.railway.com/graphql/v2";

export type RailwayVisibilityRow = {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  /** Raw Railway deployment status (e.g. SUCCESS, CRASHED, DEPLOYING). */
  deploymentStatus?: string;
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
    next: { revalidate: 0 },
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

function deploymentStatusToState(status: string): {
  state: string;
  health?: string;
} {
  const s = (status || "").toUpperCase();
  if (s === "SUCCESS") return { state: "running", health: "healthy" };
  if (s === "SLEEPING") return { state: "running", health: undefined };
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
  if (s === "FAILED" || s === "CRASHED") return { state: "exited" };
  if (s === "REMOVED") return { state: "dead" };
  return { state: "running" };
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
    const status = dep?.status ?? "UNKNOWN";
    const { state, health } = deploymentStatusToState(status);

    const createdSec = dep?.createdAt
      ? Math.floor(new Date(dep.createdAt).getTime() / 1000)
      : 0;

    const publicUrl = dep?.staticUrl || dep?.url || undefined;

    rows.push({
      id: dep?.id ?? `service:${sid}`,
      name: byId.get(sid) || sid,
      image: "Railway",
      state,
      status: dep
        ? `${status}${publicUrl ? ` · ${publicUrl}` : ""}`
        : "No deployment yet",
      deploymentStatus: dep ? status : undefined,
      service: byId.get(sid) || "",
      health,
      created: createdSec,
      railwayServiceId: sid,
      railwayDeploymentId: dep?.id,
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

/** Stop the deployment — service goes down until redeployed (chaos “kill”). */
export async function railwayDeploymentStop(deploymentId: string): Promise<void> {
  const data = await railwayGraphql<{ deploymentStop?: boolean | null }>(
    M_DEPLOYMENT_STOP,
    {
      id: deploymentId,
    }
  );
  if (data.deploymentStop === false) {
    throw new Error(
      "Railway deploymentStop returned false — check token permissions and that the deployment is stoppable."
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
