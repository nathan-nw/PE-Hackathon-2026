"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import "katex/dist/katex.min.css";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { HAPPY_AGENT_AVATAR_URL } from "@/lib/happy-branding";

export const HAPPY_WELCOME =
  "**Hi — I'm Happy.** I’m wired into this dashboard’s APIs: **logs**, **errors**, **telemetry**, **Docker/Railway**, **alerts**, **incidents**, **k6** load tests, and **Postgres** introspection.\n\n" +
  "Ask for the latest logs, error spikes, or a quick load test — or paste output you want interpreted. What should we look at?";

type ChatMessage = { role: "user" | "assistant"; content: string };

function MarkdownBody({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("happy-md text-[0.9375rem] leading-relaxed break-words", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-2 list-disc pl-5 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 list-decimal pl-5 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="mb-0.5">{children}</li>,
          h1: ({ children }) => <h3 className="mb-2 text-base font-semibold">{children}</h3>,
          h2: ({ children }) => <h4 className="mb-2 text-sm font-semibold">{children}</h4>,
          h3: ({ children }) => <h4 className="mb-1.5 text-sm font-semibold">{children}</h4>,
          a: ({ href, children }) => (
            <a
              href={href}
              className="text-foreground font-medium underline decoration-zinc-400 underline-offset-2 hover:text-zinc-950"
              target="_blank"
              rel="noreferrer"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="text-muted-foreground mb-2 border-l-[3px] border-zinc-300 pl-3 italic">
              {children}
            </blockquote>
          ),
          pre: ({ children }) => (
            <pre className="border-border mb-2 max-w-full overflow-x-auto rounded-xl border bg-zinc-50 p-3 font-mono text-[0.8rem] leading-relaxed shadow-inner dark:border-zinc-700 dark:bg-zinc-950">
              {children}
            </pre>
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = Boolean(className?.includes("language-"));
            if (isBlock) {
              return (
                <code className={cn("font-mono text-[0.8rem]", className)} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.85em] text-zinc-900 [overflow-wrap:anywhere] dark:bg-zinc-800 dark:text-zinc-100"
                {...props}
              >
                {children}
              </code>
            );
          },
          table: ({ children }) => (
            <div className="mb-2 max-w-full overflow-x-auto rounded-lg border border-zinc-200">
              <table className="w-full text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-border border bg-zinc-100 px-2 py-1.5 text-left font-medium">{children}</th>
          ),
          td: ({ children }) => <td className="border-border border px-2 py-1.5">{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export function HappyChat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, open, scrollToBottom]);

  const send = async () => {
    const trimmed = input.trim();
    if (!trimmed || pending) return;

    setError(null);
    const snapshot = messages;
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setInput("");
    setPending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy.length - 1;
          if (last >= 0 && copy[last].role === "assistant") {
            copy[last] = { role: "assistant", content: acc };
          }
          return copy;
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      setError(msg);
      setMessages(snapshot);
      setInput(trimmed);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label="Open Happy chat"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed right-5 bottom-5 z-50 flex size-[3.75rem] cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-zinc-300 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.12)] ring-2 ring-zinc-200 transition hover:scale-[1.04] hover:shadow-[0_12px_40px_rgb(0,0,0,0.15)] focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:outline-none",
          open && "pointer-events-none opacity-0"
        )}
      >
        <Image
          src={HAPPY_AGENT_AVATAR_URL}
          alt="Happy"
          width={60}
          height={60}
          className="size-full object-cover"
          unoptimized
        />
      </button>

      <div
        role="presentation"
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity duration-300",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={() => setOpen(false)}
      />

      <aside
        className={cn(
          "fixed top-0 right-0 z-40 flex h-full w-full max-w-full flex-col border-l border-border bg-background shadow-[-12px_0_40px_rgba(0,0,0,0.08)] transition-transform duration-300 ease-out sm:max-w-[min(100vw,42rem)] md:w-[40vw] md:min-w-[320px]",
          open ? "translate-x-0" : "translate-x-full"
        )}
        aria-hidden={!open}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-border bg-muted px-4 py-3.5">
          <div className="relative shrink-0">
            <Image
              src={HAPPY_AGENT_AVATAR_URL}
              alt="Happy"
              width={44}
              height={44}
              className="border-border size-11 rounded-full border-2 border-white object-cover shadow-md"
              unoptimized
            />
            <span className="absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full bg-zinc-900 text-white shadow-sm">
              <Sparkles className="size-3" aria-hidden />
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold tracking-tight text-zinc-900">Happy</h2>
            <p className="text-muted-foreground truncate text-xs font-medium">
              Live ops copilot · logs, errors, k6 &amp; more
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setOpen(false)}
            aria-label="Close chat"
            className="rounded-full text-zinc-600 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          >
            <X className="size-5" />
          </Button>
        </header>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4 [scrollbar-gutter:stable]"
        >
          <div className="mb-5 flex gap-2">
            <div className="max-w-[92%] rounded-3xl rounded-bl-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-950">
              <MarkdownBody text={HAPPY_WELCOME} />
            </div>
          </div>

          {messages.map((m, i) => (
            <div
              key={`${m.role}-${i}`}
              className={cn("mb-3.5 flex", m.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[92%] px-4 py-2.5",
                  m.role === "user"
                    ? "rounded-3xl rounded-br-md bg-zinc-900 text-white shadow-md"
                    : "rounded-3xl rounded-bl-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-950"
                )}
              >
                {m.role === "user" ? (
                  <p className="text-[0.9375rem] whitespace-pre-wrap [overflow-wrap:anywhere]">{m.content}</p>
                ) : (
                  <MarkdownBody text={m.content} className={cn(!m.content && "text-muted-foreground italic")} />
                )}
              </div>
            </div>
          ))}

          {pending &&
            messages.length > 0 &&
            messages[messages.length - 1]?.role === "user" && (
              <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
                <Loader2 className="text-muted-foreground size-3.5 animate-spin" />
                Fetching live data &amp; thinking…
              </div>
            )}

          {error && (
            <div className="mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950 dark:text-red-100">
              {error}
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t border-border bg-muted p-4 pt-3">
          <div className="flex items-end gap-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Ask about logs, errors, k6, or paste output…"
              rows={3}
              className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-[5.25rem] flex-1 resize-none rounded-2xl border border-zinc-200 px-4 py-3 text-sm shadow-inner outline-none transition focus-visible:border-zinc-400 focus-visible:ring-2 dark:border-zinc-700"
              disabled={pending}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={pending || !input.trim()}
              aria-label="Send message"
              className={cn(
                "inline-flex h-[3.25rem] min-w-[3.75rem] shrink-0 items-center justify-center rounded-2xl bg-zinc-900 px-5 text-base font-semibold text-white shadow-md transition hover:bg-zinc-800 active:scale-[0.98] dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white",
                "disabled:pointer-events-none disabled:opacity-40"
              )}
            >
              {pending ? <Loader2 className="size-6 animate-spin" /> : <Send className="size-6" strokeWidth={2.25} />}
            </button>
          </div>
          <p className="text-muted-foreground mt-2 text-center text-[0.7rem]">Shift+Enter newline · Powered by your APIs</p>
        </footer>
      </aside>
    </>
  );
}
