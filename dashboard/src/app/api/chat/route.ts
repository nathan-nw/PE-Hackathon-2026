import OpenAI from "openai";
import { NextResponse } from "next/server";

import { runtimeEnv } from "@/lib/server-runtime-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HAPPY_SYSTEM = `You are Happy, a friendly and expert operations assistant embedded in the PE Hackathon visibility dashboard. You help engineers understand application logs, HTTP errors, golden signals, load tests (k6), Docker/Railway visibility, PostgreSQL introspection, and pytest failures.

Guidelines:
- Use Markdown in your replies: headings when helpful, bullet lists, **bold** for emphasis, fenced code blocks for commands, logs, JSON, or stack traces.
- Use LaTeX math only when it genuinely clarifies (e.g. explaining percentiles or rates): inline $...$ or block $$...$$.
- You cannot run commands or access live infrastructure yourself. Suggest concrete commands (e.g. \`uv run pytest -k foo -v\`, \`docker compose logs url-shortener-a\`) and help interpret pasted output.
- Be concise but thorough; prefer actionable steps when debugging.
- If the user asks about data you cannot see, ask them to paste relevant log lines or metrics from the dashboard.`;

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

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "system", content: HAPPY_SYSTEM }, ...convo];

  const model = runtimeEnv("OPENAI_MODEL") ?? "gpt-4o-mini";

  const openai = new OpenAI({ apiKey });

  try {
    const stream = await openai.chat.completions.create({
      model,
      messages,
      stream: true,
      temperature: 0.4,
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content ?? "";
            if (text) controller.enqueue(encoder.encode(text));
          }
        } catch (e) {
          console.error("[chat] stream error", e);
          controller.error(e);
          return;
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
  } catch (e) {
    console.error("[chat] OpenAI error", e);
    const msg = e instanceof Error ? e.message : "OpenAI request failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
