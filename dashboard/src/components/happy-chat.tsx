"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import "katex/dist/katex.min.css";
import { Loader2, Send, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

const HAPPY_AVATAR_URL =
  "https://scontent-yyz1-1.xx.fbcdn.net/v/t39.30808-1/309431358_839585507201666_5985498661297484474_n.jpg?stp=dst-jpg_s200x200_tt6&_nc_cat=108&ccb=1-7&_nc_sid=2d3e12&_nc_ohc=KFjupLz53d4Q7kNvwFbX2BC&_nc_oc=AdoaeOOiDneeCg_USvKqpjpNxM5PNb9H122XsKrB3IJBjqw6DL9FYOQofTuBt7cYl4A&_nc_zt=24&_nc_ht=scontent-yyz1-1.xx&_nc_gid=SgAVuAma207_wNxbkFIvug&_nc_ss=7a3a8&oh=00_Af3p3gPSNBSYzggOstJkRUDatjpjl2dKqPiWxl-GsG6YfA&oe=69D83B42";

export const HAPPY_WELCOME =
  "**Hey — I'm Happy.** I'm your ops copilot for this dashboard: application logs, errors, golden signals, load tests, and DB visibility.\n\n" +
  "Paste stack traces or log lines, ask what a failing test might mean, or get ideas for debugging and which commands to run (`pytest`, `k6`, `docker compose logs`, …). What would you like to tackle?";

type ChatMessage = { role: "user" | "assistant"; content: string };

function MarkdownBody({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("happy-md text-sm leading-relaxed break-words", className)}>
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
            <a href={href} className="text-primary underline underline-offset-2" target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-border text-muted-foreground mb-2 border-l-2 pl-3">{children}</blockquote>
          ),
          pre: ({ children }) => (
            <pre className="border-border bg-muted/80 mb-2 max-w-full overflow-x-auto rounded-lg border p-3 font-mono text-xs leading-normal">
              {children}
            </pre>
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = Boolean(className?.includes("language-"));
            if (isBlock) {
              return (
                <code className={cn("font-mono text-xs", className)} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="bg-muted rounded px-1.5 py-0.5 font-mono text-[0.9em] [overflow-wrap:anywhere]"
                {...props}
              >
                {children}
              </code>
            );
          },
          table: ({ children }) => (
            <div className="mb-2 max-w-full overflow-x-auto">
              <table className="border-border text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-border bg-muted/50 border px-2 py-1 text-left font-medium">{children}</th>
          ),
          td: ({ children }) => <td className="border-border border px-2 py-1">{children}</td>,
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
          "border-border bg-background fixed right-5 bottom-5 z-50 flex size-14 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 shadow-lg transition hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          open && "pointer-events-none opacity-0"
        )}
      >
        <Image
          src={HAPPY_AVATAR_URL}
          alt="Happy"
          width={56}
          height={56}
          className="size-full object-cover"
          unoptimized
        />
      </button>

      <div
        role="presentation"
        className={cn(
          "fixed inset-0 z-40 bg-black/25 transition-opacity duration-300",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={() => setOpen(false)}
      />

      <aside
        className={cn(
          "border-border bg-background fixed top-0 right-0 z-40 flex h-full w-full max-w-full flex-col border-l shadow-2xl transition-transform duration-300 ease-out sm:max-w-[min(100vw,42rem)] md:w-[40vw] md:min-w-[320px]",
          open ? "translate-x-0" : "translate-x-full"
        )}
        aria-hidden={!open}
      >
        <header className="border-border flex shrink-0 items-center gap-3 border-b px-4 py-3">
          <Image
            src={HAPPY_AVATAR_URL}
            alt="Happy"
            width={40}
            height={40}
            className="border-border size-10 shrink-0 rounded-full border object-cover"
            unoptimized
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold tracking-tight">Happy</h2>
            <p className="text-muted-foreground truncate text-xs">Ops copilot · logs, tests &amp; errors</p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close chat">
            <X className="size-4" />
          </Button>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="mb-4 flex gap-2">
            <div className="border-border bg-muted/40 max-w-[92%] rounded-2xl rounded-bl-md border px-3 py-2">
              <MarkdownBody text={HAPPY_WELCOME} />
            </div>
          </div>

          {messages.map((m, i) => (
            <div
              key={`${m.role}-${i}`}
              className={cn("mb-3 flex", m.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[92%] rounded-2xl px-3 py-2",
                  m.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "border-border bg-muted/40 rounded-bl-md border"
                )}
              >
                {m.role === "user" ? (
                  <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{m.content}</p>
                ) : (
                  <MarkdownBody text={m.content} className={cn(!m.content && "text-muted-foreground italic")} />
                )}
              </div>
            </div>
          ))}

          {pending &&
            messages.length > 0 &&
            messages[messages.length - 1]?.role === "user" && (
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <Loader2 className="size-3.5 animate-spin" />
                Happy is thinking…
              </div>
            )}

          {error && (
            <div className="bg-destructive/10 text-destructive mb-2 rounded-lg px-3 py-2 text-xs">{error}</div>
          )}
        </div>

        <footer className="border-border shrink-0 border-t p-3">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Ask about logs, errors, or tests… (Shift+Enter for newline)"
              rows={2}
              className="border-input bg-background focus-visible:ring-ring placeholder:text-muted-foreground flex-1 resize-none rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2"
              disabled={pending}
            />
            <Button
              type="button"
              size="icon"
              className="h-auto shrink-0 self-end"
              onClick={() => void send()}
              disabled={pending || !input.trim()}
              aria-label="Send message"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
        </footer>
      </aside>
    </>
  );
}
