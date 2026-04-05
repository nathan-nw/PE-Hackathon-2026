import OpenAI from "openai";
import { NextResponse } from "next/server";

import { HAPPY_TOOLS } from "@/lib/happy-tools/definitions";
import { executeHappyTool } from "@/lib/happy-tools/execute";
import { dashboardSelfOrigin } from "@/lib/happy-tools/self-origin";
import { runtimeEnv } from "@/lib/server-runtime-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HAPPY_SYSTEM = `You are Happy, a friendly and expert operations assistant embedded in the PE Hackathon visibility dashboard.

You have **tools** that call the same live APIs as the Ops UI: application logs (Kafka-backed cache), error analytics, log insights, golden-signal telemetry, Docker/Railway visibility, Postgres introspection, Alertmanager alerts, incident timeline, k6 load tests, and (when enabled on the host) pytest.

Guidelines:
- **Prefer calling tools** when the user asks about current logs, errors, metrics, containers, load tests, or database layout. Do not claim you cannot access data if a tool can fetch it.
- Summarize tool output clearly: pull out counts, anomalies, and representative lines — avoid dumping huge JSON.
- Use Markdown: **bold**, lists, fenced code blocks for commands, logs, or snippets.
- Use LaTeX only when it clarifies math (rates, percentiles): $...$ or $$...$$.
- For k6: use k6_get_status before/after; explain presets and duration when starting tests.
- For pytest: use run_pytest only when enabled; otherwise suggest \`uv run pytest ...\` for the user to run locally.
- Be concise, actionable, and kind.`;

type IncomingMessage = { role: "user" | "assistant"; content: string };

export async function POST(request: Request) {
  const apiKey = runtimeEnv("OPENAI_API_KEY");
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "OPENAI_API_KEY is not set. Add it to the dashboard environment (e.g. .env.local or docker-compose) and restart.",
      },
      { status: 503 }
    );
  }

  let body: { messages?: IncomingMessage[] };
  try {
    body = (await request.json()) as { messages?: IncomingMessage[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = body.messages;
  if (!Array.isArray(raw) || raw.length === 0) {
    return NextResponse.json({ error: "Expected a non-empty messages array" }, { status: 400 });
  }

  const convo: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  for (const m of raw) {
    if (m.role !== "user" && m.role !== "assistant") {
      return NextResponse.json({ error: "Invalid message role" }, { status: 400 });
    }
    if (typeof m.content !== "string") {
      return NextResponse.json({ error: "Invalid message content" }, { status: 400 });
    }
    convo.push({ role: m.role, content: m.content });
  }

  const model = runtimeEnv("OPENAI_MODEL") ?? "gpt-4o-mini";
  const openai = new OpenAI({ apiKey });
  const selfOrigin = dashboardSelfOrigin();

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: HAPPY_SYSTEM },
    ...convo,
  ];

  const maxRounds = 12;

  try {
    for (let round = 0; round < maxRounds; round++) {
      const completion = await openai.chat.completions.create({
        model,
        messages,
        tools: HAPPY_TOOLS,
        tool_choice: "auto",
        temperature: 0.35,
        max_tokens: 4096,
      });

      const msg = completion.choices[0]?.message;
      if (!msg) {
        return NextResponse.json({ error: "Empty model response" }, { status: 502 });
      }

      if (msg.tool_calls?.length) {
        messages.push(msg);
        for (const tc of msg.tool_calls) {
          if (tc.type !== "function") continue;
          const fn = tc.function;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(fn.arguments || "{}") as Record<string, unknown>;
          } catch {
            args = {};
          }
          const result = await executeHappyTool(fn.name, args, { selfOrigin });
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: result,
          });
        }
        continue;
      }

      const text = msg.content ?? "";
      if (!text.trim()) {
        return NextResponse.json({ error: "Model returned no text after tools" }, { status: 502 });
      }

      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        start(controller) {
          const chunkSize = 48;
          for (let i = 0; i < text.length; i += chunkSize) {
            controller.enqueue(encoder.encode(text.slice(i, i + chunkSize)));
          }
          controller.close();
        },
      });

      return new Response(readable, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json({ error: "Too many tool rounds — try a narrower question." }, { status: 500 });
  } catch (e) {
    console.error("[chat] OpenAI / tools error", e);
    const msg = e instanceof Error ? e.message : "OpenAI request failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
