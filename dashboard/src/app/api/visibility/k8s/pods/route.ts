import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import * as k8s from "@kubernetes/client-node";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isK8sEnabled(): boolean {
  const v = (process.env.VISIBILITY_K8S_ENABLED ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function envFlagTrue(name: string): boolean {
  const v = (process.env[name] ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function isRegularFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Expand a path that might be a directory (mis-set KUBECONFIG) to .../config. */
function kubeconfigPathCandidates(p: string): string[] {
  const out: string[] = [p];
  try {
    if (fs.statSync(p).isDirectory()) {
      out.push(path.join(p, "config"));
    }
  } catch {
    /* missing path */
  }
  return out;
}

/** Prefer explicit KUBECONFIG, then ~/.kube/config, then client defaults. */
function loadKubeConfig(kc: k8s.KubeConfig): void {
  const fromEnv = process.env.KUBECONFIG?.trim();
  const homeConfig = path.join(os.homedir(), ".kube", "config");
  const raw = [fromEnv, homeConfig].filter((p): p is string => Boolean(p));
  const tried: string[] = [];
  const seen = new Set<string>();

  for (const r of raw) {
    for (const p of kubeconfigPathCandidates(r)) {
      if (seen.has(p)) continue;
      seen.add(p);
      tried.push(p);
      if (isRegularFile(p)) {
        kc.loadFromFile(p);
        return;
      }
    }
  }

  throw new Error(
    `No kubeconfig file found. Tried: ${tried.join(", ")}. ` +
      `KUBECONFIG must be a file path (e.g. ...\\.kube\\config), not a directory. ` +
      `Copy your config (PowerShell): ` +
      `New-Item -ItemType Directory -Force -Path "$env:LOCALAPPDATA\\kube" | Out-Null; ` +
      `Copy-Item -Force "$env:USERPROFILE\\.kube\\config" "$env:LOCALAPPDATA\\kube\\config" ` +
      `— or set KUBECONFIG to a real file path. Docker Desktop: ensure Kubernetes is enabled and a cluster context exists.`,
  );
}

function formatAge(created: Date | string | undefined): string {
  if (!created) return "—";
  const t =
    created instanceof Date ? created.getTime() : new Date(created).getTime();
  if (Number.isNaN(t)) return "—";
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export async function GET(request: Request) {
  if (!isK8sEnabled()) {
    return NextResponse.json({
      enabled: false,
      namespace: process.env.VISIBILITY_K8S_NAMESPACE ?? "pe-hackathon",
      pods: [] as unknown[],
      message: "Kubernetes visibility is disabled (set VISIBILITY_K8S_ENABLED=true and mount kubeconfig).",
    });
  }

  const url = new URL(request.url);
  const allNamespaces =
    url.searchParams.get("allNamespaces") === "1" ||
    url.searchParams.get("all") === "1" ||
    envFlagTrue("VISIBILITY_K8S_ALL_NAMESPACES");

  const ns = process.env.VISIBILITY_K8S_NAMESPACE || "pe-hackathon";

  try {
    const kc = new k8s.KubeConfig();
    loadKubeConfig(kc);
    const api = kc.makeApiClient(k8s.CoreV1Api);
    const res = allNamespaces
      ? await api.listPodForAllNamespaces({})
      : await api.listNamespacedPod({ namespace: ns });
    const items = res.items ?? [];

    const pods = items.map((p) => {
      const statuses = p.status?.containerStatuses ?? [];
      const ready = statuses.filter((cs) => cs.ready).length;
      const total = statuses.length;
      const restarts = statuses.reduce((acc, cs) => acc + (cs.restartCount ?? 0), 0);
      return {
        name: p.metadata?.name ?? "",
        namespace: p.metadata?.namespace ?? ns,
        phase: p.status?.phase ?? "Unknown",
        ready: `${ready}/${total || "?"}`,
        restarts,
        age: formatAge(p.metadata?.creationTimestamp),
      };
    });

    return NextResponse.json({
      enabled: true,
      namespace: allNamespaces ? "*" : ns,
      allNamespaces,
      pods,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      {
        enabled: true,
        namespace: allNamespaces ? "*" : ns,
        allNamespaces,
        pods: [],
        error: message,
      },
      { status: 503 }
    );
  }
}
