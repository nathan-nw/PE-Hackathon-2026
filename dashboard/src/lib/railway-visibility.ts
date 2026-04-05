/**
 * Railway GraphQL (same API as the Railway dashboard).
 * Used when the app runs on Railway: there is no /var/run/docker.sock.
 *
 * Auth: account token (Authorization: Bearer) or project token (Project-Access-Token).
 * @see https://docs.railway.com/reference/public-api
 */

const ENDPOINT = "https://backboard.railway.com/graphql/v2";

export type RailwayVisibilityRow = {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  service: string;
  health?: string;
  created: number;
  railwayServiceId: string;
  railwayDeploymentId?: string;
  railwayPublicUrl?: string;
};

type GqlResponse<T> = { data?: T; errors?: { message: string }[] };

function getAuthHeaders(): Record<string, string> {
  const account = process.env.RAILWAY_API_TOKEN || process.env.RAILWAY_TOKEN;
  const project = process.env.RAILWAY_PROJECT_TOKEN;
  if (project) {
    return { "Project-Access-Token": project };
  }
  if (account) {
    return { Authorization: `Bearer ${account}` };
  }
  throw new Error(
    "Set RAILWAY_PROJECT_TOKEN or RAILWAY_API_TOKEN for Railway visibility"
  );
}

async function gql<T>(query: string, variables?: Record<string, string>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
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

export function railwayIdsConfigured(): boolean {
  return Boolean(
    process.env.RAILWAY_PROJECT_ID && process.env.RAILWAY_ENVIRONMENT_ID
  );
}

export function railwayVisibilityConfigured(): boolean {
  return Boolean(
    railwayIdsConfigured() &&
      (process.env.RAILWAY_API_TOKEN ||
        process.env.RAILWAY_TOKEN ||
        process.env.RAILWAY_PROJECT_TOKEN)
  );
}

export async function fetchRailwayVisibilityRows(): Promise<{
  project: string;
  projectId: string;
  containers: RailwayVisibilityRow[];
  error?: string;
}> {
  const projectId = process.env.RAILWAY_PROJECT_ID!;
  const environmentId = process.env.RAILWAY_ENVIRONMENT_ID!;

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
      service: byId.get(sid) || "",
      health,
      created: createdSec,
      railwayServiceId: sid,
      railwayDeploymentId: dep?.id,
      railwayPublicUrl: publicUrl ?? undefined,
    });
  }

  return { project: projectName, projectId, containers: rows };
}
