import Docker from "dockerode";

/**
 * Dockerode connection options for the local Engine API.
 * - Linux/macOS: Unix socket (default in containers / Docker Desktop VM).
 * - Windows (Docker Desktop): named pipe `//./pipe/docker_engine`.
 * Override with `DOCKER_SOCKET_PATH` or standard `DOCKER_HOST` when needed.
 */
export function getDockerConnectionOptions(): ConstructorParameters<typeof Docker>[0] {
  const socketPath = process.env.DOCKER_SOCKET_PATH;
  if (socketPath) {
    return { socketPath };
  }

  const host = process.env.DOCKER_HOST;
  if (host) {
    try {
      const u = new URL(host.replace(/^tcp:/, "http:"));
      return {
        host: u.hostname,
        port: u.port || "2375",
        protocol: u.protocol === "https:" ? "https" : "http",
      };
    } catch {
      /* fall through to socket / pipe */
    }
  }

  if (process.platform === "win32") {
    return { socketPath: "//./pipe/docker_engine" };
  }

  return { socketPath: "/var/run/docker.sock" };
}
