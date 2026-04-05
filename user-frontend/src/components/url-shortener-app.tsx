"use client";

import { ExternalLink, Link2, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fkId,
  formatWhen,
  normalizeBase,
  normalizeLoopbackHost,
  shortFull,
} from "@/lib/backend";
import { cn } from "@/lib/utils";

const STORAGE_RECENT = "pe_shortener_recent_v1";
const MAX_RECENT = 12;

type RecentEntry = {
  base: string;
  short: string;
  full: string;
  original: string;
};

type UrlRow = {
  id: number;
  short_code: string;
  original_url?: string | null;
  title?: string | null;
  user_id: number | { id: number };
  is_active: boolean;
  created_at?: string | null;
};

type BrowseMode = "idle" | "all" | "user";

export function UrlShortenerApp() {
  const [backendBase, setBackendBase] = useState<string | null>(null);
  const [configLoading, setConfigLoading] = useState(true);

  const [longUrl, setLongUrl] = useState("");
  const [userId, setUserId] = useState("1");
  const [title, setTitle] = useState("");
  const [shortCode, setShortCode] = useState("");

  const [formErr, setFormErr] = useState("");
  const [formOk, setFormOk] = useState("");
  const [lastFull, setLastFull] = useState("");
  const [showResult, setShowResult] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [recent, setRecent] = useState<RecentEntry[]>([]);

  const [listPage, setListPage] = useState("1");
  const [listPerPage, setListPerPage] = useState("20");
  const [browseErr, setBrowseErr] = useState("");
  const [browseOk, setBrowseOk] = useState("");
  const [rows, setRows] = useState<UrlRow[]>([]);
  const [browseMode, setBrowseMode] = useState<BrowseMode>("idle");
  const [browsePage, setBrowsePage] = useState(1);
  const [browsePerPage, setBrowsePerPage] = useState(20);
  const [browseTotal, setBrowseTotal] = useState(0);
  const [browseUserId, setBrowseUserId] = useState<number | null>(null);
  const [loadAllPending, setLoadAllPending] = useState(false);
  const [loadUserPending, setLoadUserPending] = useState(false);

  const [eventsForId, setEventsForId] = useState<number | null>(null);
  const [eventsText, setEventsText] = useState("");

  const getBrowseBase = useCallback(() => {
    if (!backendBase) return "";
    return normalizeLoopbackHost(normalizeBase(backendBase));
  }, [backendBase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/config", { cache: "no-store" });
        const data = (await res.json()) as { backendUrl?: string };
        const raw = (data.backendUrl || "").trim() || "http://localhost:18080";
        if (!cancelled) {
          setBackendBase(normalizeBase(raw));
        }
      } catch {
        if (!cancelled) setBackendBase("http://localhost:18080");
      } finally {
        if (!cancelled) setConfigLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_RECENT);
      setRecent(raw ? (JSON.parse(raw) as RecentEntry[]) : []);
    } catch {
      setRecent([]);
    }
  }, []);

  const saveRecent = useCallback((entry: RecentEntry) => {
    setRecent((prev) => {
      const next = [entry, ...prev.filter((x) => x.short !== entry.short || x.base !== entry.base)].slice(
        0,
        MAX_RECENT
      );
      try {
        localStorage.setItem(STORAGE_RECENT, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const hideEvents = useCallback(() => {
    setEventsForId(null);
    setEventsText("");
  }, []);

  const toggleEvents = useCallback(
    async (urlId: number) => {
      const base = getBrowseBase();
      if (eventsForId === urlId) {
        hideEvents();
        return;
      }
      setEventsForId(urlId);
      setEventsText("Loading…");
      try {
        const res = await fetch(`${base}/urls/${urlId}/events`, {
          headers: { Accept: "application/json" },
        });
        const data = (await res.json().catch(() => null)) as { error?: string } | unknown;
        if (!res.ok) {
          setEventsText(
            (data && typeof data === "object" && data !== null && "error" in data && typeof (data as { error: unknown }).error === "string"
              ? (data as { error: string }).error
              : null) || res.statusText || "Failed"
          );
          return;
        }
        setEventsText(JSON.stringify(data, null, 2));
      } catch (e) {
        setEventsText(e instanceof Error ? e.message : String(e));
      }
    },
    [eventsForId, getBrowseBase, hideEvents]
  );

  const renderBrowseTable = useCallback(
    (list: UrlRow[], meta: { mode: "all" | "user"; page?: number; perPage?: number; total?: number; userId?: number }) => {
      setBrowseErr("");
      hideEvents();
      setRows(list);
      if (meta.mode === "all") {
        setBrowseMode("all");
        setBrowsePage(meta.page ?? 1);
        setBrowsePerPage(meta.perPage ?? 20);
        setBrowseTotal(meta.total ?? 0);
      } else {
        setBrowseMode("user");
        setBrowseUserId(meta.userId ?? null);
      }
    },
    [hideEvents]
  );

  const refreshBrowse = useCallback(async () => {
    if (browseMode === "all") {
      const p = browsePage;
      const base = getBrowseBase();
      const per = Math.min(100, Math.max(1, browsePerPage));
      const res = await fetch(`${base}/urls?page=${p}&per_page=${per}`, {
        headers: { Accept: "application/json" },
      });
      const data = (await res.json().catch(() => null)) as {
        data?: UrlRow[];
        page?: number;
        per_page?: number;
        total?: number;
        error?: string;
      } | null;
      if (!res.ok || !data) {
        setBrowseErr((data?.error || res.statusText) + ` (${res.status})`);
        return;
      }
      renderBrowseTable(data.data || [], {
        mode: "all",
        page: data.page,
        perPage: data.per_page,
        total: data.total,
      });
    } else if (browseMode === "user") {
      const uid = parseInt(userId, 10);
      if (!uid || uid < 1) return;
      const base = getBrowseBase();
      const res = await fetch(`${base}/users/${uid}/urls`, {
        headers: { Accept: "application/json" },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const err = (data as { error?: string } | null)?.error || res.statusText;
        setBrowseErr(`${err} (${res.status})`);
        return;
      }
      const arr = Array.isArray(data) ? (data as UrlRow[]) : [];
      renderBrowseTable(arr, { mode: "user", userId: uid });
    }
  }, [browseMode, browsePage, browsePerPage, getBrowseBase, renderBrowseTable, userId]);

  const deactivateUrl = useCallback(
    async (urlId: number) => {
      if (!confirm("Deactivate this short link? (soft delete)")) return;
      const base = getBrowseBase();
      try {
        const res = await fetch(`${base}/urls/${urlId}`, { method: "DELETE" });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setBrowseErr(`${data.error || res.statusText} (${res.status})`);
          return;
        }
        setBrowseErr("");
        setBrowseOk("URL deactivated.");
        await refreshBrowse();
      } catch (e) {
        setBrowseErr(e instanceof Error ? e.message : String(e));
      }
    },
    [getBrowseBase, refreshBrowse]
  );

  const reactivateUrl = useCallback(
    async (urlId: number) => {
      const base = getBrowseBase();
      try {
        const res = await fetch(`${base}/urls/${urlId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ is_active: true }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setBrowseErr(`${data.error || res.statusText} (${res.status})`);
          return;
        }
        setBrowseErr("");
        setBrowseOk("URL reactivated.");
        await refreshBrowse();
      } catch (e) {
        setBrowseErr(e instanceof Error ? e.message : String(e));
      }
    },
    [getBrowseBase, refreshBrowse]
  );

  const doLoadAll = useCallback(
    async (page?: number) => {
      const base = getBrowseBase();
      let per = parseInt(listPerPage, 10) || 20;
      per = Math.min(100, Math.max(1, per));
      setListPerPage(String(per));
      let p = page ?? (parseInt(listPage, 10) || 1);
      p = Math.max(1, p);
      setListPage(String(p));
      setLoadAllPending(true);
      setBrowseErr("");
      setBrowseOk("");
      try {
        const res = await fetch(`${base}/urls?page=${p}&per_page=${per}`, {
          headers: { Accept: "application/json" },
        });
        const data = (await res.json().catch(() => null)) as {
          data?: UrlRow[];
          page?: number;
          per_page?: number;
          total?: number;
          error?: string;
        } | null;
        if (!res.ok || !data) {
          setBrowseErr((data?.error || res.statusText || "Request failed") + ` (${res.status})`);
          setRows([]);
          return;
        }
        renderBrowseTable(data.data || [], {
          mode: "all",
          page: data.page,
          perPage: data.per_page,
          total: data.total,
        });
      } catch (e) {
        setBrowseErr(
          e instanceof Error
            ? e.message
            : "Network error — check BACKEND_URL / load balancer deployment."
        );
        setRows([]);
      } finally {
        setLoadAllPending(false);
      }
    },
    [getBrowseBase, listPage, listPerPage, renderBrowseTable]
  );

  const doLoadUser = useCallback(async () => {
    const base = getBrowseBase();
    const uid = parseInt(userId, 10);
    if (!uid || uid < 1) {
      setBrowseErr("User ID must be a positive integer.");
      return;
    }
    setLoadUserPending(true);
    setBrowseErr("");
    setBrowseOk("");
    try {
      const res = await fetch(`${base}/users/${uid}/urls`, {
        headers: { Accept: "application/json" },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const err = (data as { error?: string } | null)?.error || res.statusText;
        setBrowseErr(`${err} (${res.status})`);
        setRows([]);
        return;
      }
      const arr = Array.isArray(data) ? (data as UrlRow[]) : [];
      renderBrowseTable(arr, { mode: "user", userId: uid });
    } catch (e) {
      setBrowseErr(
        e instanceof Error
          ? e.message
          : "Network error — check BACKEND_URL / load balancer deployment."
      );
      setRows([]);
    } finally {
      setLoadUserPending(false);
    }
  }, [getBrowseBase, renderBrowseTable, userId]);

  const onSubmit = useCallback(async () => {
    setFormErr("");
    setFormOk("");
    setShowResult(false);
    const base = getBrowseBase();
    const lu = longUrl.trim();
    if (!lu) {
      setFormErr("Enter a URL to shorten.");
      return;
    }
    const uid = parseInt(userId, 10);
    if (!uid || uid < 1) {
      setFormErr("User ID must be a positive integer.");
      return;
    }
    const body: Record<string, unknown> = {
      original_url: lu,
      user_id: uid,
    };
    const t = title.trim();
    if (t) body.title = t;
    const sc = shortCode.trim();
    if (sc) body.short_code = sc;

    setSubmitting(true);
    try {
      const res = await fetch(`${base}/shorten`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { short_code?: string; error?: string };
      if (!res.ok) {
        setFormErr(`${data.error || res.statusText || "Request failed"} (${res.status})`);
        return;
      }
      const code = data.short_code;
      if (!code) {
        setFormErr("Unexpected response from API.");
        return;
      }
      const full = `${base}/${encodeURIComponent(code)}`;
      setLastFull(full);
      setShowResult(true);
      setFormOk("Created.");
      saveRecent({ base, short: full, full, original: lu });
    } catch (e) {
      setFormErr(
        e instanceof Error
          ? e.message
          : "Network error — check BACKEND_URL (NGINX load balancer). Wrong host/port often surfaces as a CORS error."
      );
    } finally {
      setSubmitting(false);
    }
  }, [getBrowseBase, longUrl, userId, title, shortCode, saveRecent]);

  const lastPageAll = Math.max(1, Math.ceil(browseTotal / browsePerPage) || 1);

  if (configLoading) {
    return (
      <div className="relative z-[1] flex min-h-[100dvh] items-center justify-center">
        <Loader2 className="text-muted-foreground size-8 animate-spin" aria-hidden />
        <span className="sr-only">Loading</span>
      </div>
    );
  }

  return (
    <div className="relative z-[1] min-h-[100dvh]">
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-12 sm:px-6 sm:pb-20 sm:pt-16">
        <header className="mb-12 text-center sm:mb-14">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/80 px-3.5 py-1.5 text-xs font-medium tracking-wide text-muted-foreground shadow-sm backdrop-blur-sm">
            <Link2 className="size-3.5 text-primary" aria-hidden />
            URL shortener
          </div>
          <h1 className="text-foreground text-3xl font-semibold tracking-tight sm:text-4xl">
            Shorten a link
          </h1>
          <p className="text-muted-foreground mx-auto mt-3 max-w-xl text-sm leading-relaxed">
            <code className="rounded-md border border-border/60 bg-muted/80 px-1.5 py-0.5 font-mono text-[0.8rem]">
              POST /shorten
            </code>
            {" · "}
            <code className="rounded-md border border-border/60 bg-muted/80 px-1.5 py-0.5 font-mono text-[0.8rem]">
              GET /urls
            </code>
            {" · "}
            <code className="rounded-md border border-border/60 bg-muted/80 px-1.5 py-0.5 font-mono text-[0.8rem]">
              GET /users/&lt;id&gt;/urls
            </code>
            <span className="mt-2 block text-[0.8125rem]">Uses a valid user ID for new links.</span>
          </p>
        </header>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Create</CardTitle>
            <CardDescription>
              API base comes from{" "}
              <code className="bg-muted rounded px-1 py-0.5 text-xs">/api/config</code> (
              <code className="text-xs">BACKEND_URL</code> in Docker/Railway). Local Compose:{" "}
              <code className="text-xs">USER_FRONTEND_BACKEND_URL</code> in repo{" "}
              <code className="text-xs">.env</code> (default{" "}
              <code className="text-xs">http://localhost:18080</code>).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="longUrl">Long URL</Label>
              <Input
                id="longUrl"
                type="url"
                placeholder="https://example.com/path"
                value={longUrl}
                onChange={(e) => setLongUrl(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="userId">User ID</Label>
                <Input
                  id="userId"
                  type="number"
                  min={1}
                  step={1}
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="title">Title (optional)</Label>
                <Input
                  id="title"
                  type="text"
                  placeholder="My link"
                  maxLength={500}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="shortCode">Custom short code (optional)</Label>
              <Input
                id="shortCode"
                placeholder="Leave empty for random"
                maxLength={20}
                pattern="[A-Za-z0-9]*"
                value={shortCode}
                onChange={(e) => setShortCode(e.target.value)}
              />
            </div>
            <Button
              type="button"
              className="w-full sm:w-auto"
              disabled={submitting}
              onClick={() => void onSubmit()}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Creating…
                </>
              ) : (
                "Create short link"
              )}
            </Button>

            {formErr ? (
              <div
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
                role="alert"
              >
                {formErr}
              </div>
            ) : null}
            {formOk ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                {formOk}
              </div>
            ) : null}

            {showResult && lastFull ? (
              <div className="bg-muted/50 space-y-3 rounded-lg border p-4">
                <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  Short URL
                </p>
                <p className="text-primary font-mono text-sm break-all">{lastFull}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(lastFull).then(
                        () => setFormOk("Copied to clipboard."),
                        () => setFormErr("Could not copy — select the link manually.")
                      );
                    }}
                  >
                    Copy
                  </Button>
                  <a
                    href={lastFull}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Open
                    <ExternalLink className="ml-1 size-3.5" />
                  </a>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {recent.length > 0 ? (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="text-base">Recent (this browser)</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-border divide-y">
                {recent.map((item) => (
                  <li
                    key={`${item.base}-${item.short}`}
                    className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <a
                      href={item.full}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary text-sm font-medium hover:underline"
                    >
                      {item.short}
                    </a>
                    <span
                      className="text-muted-foreground max-w-[55%] truncate text-xs"
                      title={item.original}
                    >
                      {item.original}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>URLs from the database</CardTitle>
            <CardDescription>
              <code className="bg-muted rounded px-1 text-xs">GET /urls</code> (paginated) and{" "}
              <code className="bg-muted rounded px-1 text-xs">GET /users/&lt;id&gt;/urls</code>.
              Actions: <code className="text-xs">DELETE /urls/&lt;id&gt;</code>,{" "}
              <code className="text-xs">PUT</code> to reactivate,{" "}
              <code className="text-xs">GET /urls/&lt;id&gt;/events</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="listPage">Page</Label>
                <Input
                  id="listPage"
                  type="number"
                  min={1}
                  className="w-24"
                  value={listPage}
                  onChange={(e) => setListPage(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="listPerPage">Per page</Label>
                <Input
                  id="listPerPage"
                  type="number"
                  min={1}
                  max={100}
                  className="w-24"
                  value={listPerPage}
                  onChange={(e) => setListPerPage(e.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={loadAllPending}
                onClick={() => {
                  const p = Math.max(1, parseInt(listPage, 10) || 1);
                  void doLoadAll(p);
                }}
              >
                {loadAllPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                Load all URLs
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={loadUserPending}
                onClick={() => void doLoadUser()}
              >
                {loadUserPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                Load this user&apos;s URLs
              </Button>
            </div>

            {browseErr ? (
              <div
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
                role="alert"
              >
                {browseErr}
              </div>
            ) : null}
            {browseOk ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                {browseOk}
              </div>
            ) : null}

            {browseMode === "all" && rows.length > 0 ? (
              <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
                <span>
                  Page {browsePage} of {lastPageAll} · {browseTotal} total
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={browsePage <= 1}
                  onClick={() => {
                    const p = browsePage - 1;
                    setListPage(String(p));
                    void doLoadAll(p);
                  }}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={browsePage >= lastPageAll}
                  onClick={() => {
                    const p = browsePage + 1;
                    setListPage(String(p));
                    void doLoadAll(p);
                  }}
                >
                  Next
                </Button>
              </div>
            ) : null}

            {rows.length === 0 && browseMode === "idle" ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                Click <strong>Load all URLs</strong> or <strong>Load this user&apos;s URLs</strong> to
                fetch from the API.
              </p>
            ) : null}

            {rows.length === 0 && browseMode !== "idle" ? (
              <p className="text-muted-foreground py-6 text-center text-sm">No URLs returned.</p>
            ) : null}

            {rows.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Short link</TableHead>
                    <TableHead>Original</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="min-w-[12rem]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const base = getBrowseBase();
                    const full = base && row.short_code ? shortFull(base, row.short_code) : "";
                    const uid = fkId(row.user_id);
                    return (
                      <TableRow key={row.id}>
                        <TableCell>{row.id}</TableCell>
                        <TableCell>
                          {full ? (
                            <a
                              href={full}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary font-mono text-xs hover:underline"
                            >
                              {row.short_code}
                            </a>
                          ) : (
                            row.short_code || "—"
                          )}
                        </TableCell>
                        <TableCell className="max-w-[14rem]">
                          <span className="text-muted-foreground block truncate" title={row.original_url || ""}>
                            {row.original_url || "—"}
                          </span>
                        </TableCell>
                        <TableCell>{row.title || "—"}</TableCell>
                        <TableCell>{uid != null ? String(uid) : "—"}</TableCell>
                        <TableCell>
                          <Badge variant={row.is_active ? "success" : "destructive"}>
                            {row.is_active ? "active" : "inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-normal text-xs">
                          {formatWhen(row.created_at ?? undefined)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => {
                                if (!full) return;
                                void navigator.clipboard.writeText(full).then(() => {
                                  setBrowseErr("");
                                  setBrowseOk("Copied short URL.");
                                });
                              }}
                            >
                              Copy
                            </Button>
                            <a
                              href={full || "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 text-xs")}
                            >
                              Open
                            </a>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => void toggleEvents(row.id)}
                            >
                              Events
                            </Button>
                            {row.is_active ? (
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => void deactivateUrl(row.id)}
                              >
                                Deactivate
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => void reactivateUrl(row.id)}
                              >
                                Reactivate
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : null}

            {browseMode === "user" && rows.length > 0 ? (
              <p className="text-muted-foreground text-sm">
                {rows.length} URL(s) for user {browseUserId}
              </p>
            ) : null}

            {eventsForId != null ? (
              <div className="bg-muted/40 max-h-48 overflow-auto rounded-lg border p-3">
                <p className="text-muted-foreground mb-2 text-xs font-medium">Events</p>
                <pre className="text-foreground font-mono text-xs whitespace-pre-wrap break-words">
                  {eventsText}
                </pre>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="border-border/50 mt-14 border-t pt-8">
          <p className="text-muted-foreground text-center text-xs">
            Backend:{" "}
            <code className="rounded-md border border-border/50 bg-muted/60 px-1.5 py-0.5 font-mono text-[0.7rem]">
              {backendBase || "—"}
            </code>
          </p>
        </div>
      </div>
    </div>
  );
}
