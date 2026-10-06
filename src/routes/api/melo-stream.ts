import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { DEFAULT_LIMITS, SYSTEM, personaLine, todayUtc, type LimitsConfig } from "@/lib/melo.functions";

const MODEL = "google/gemini-3.8-flash";

const input = z.object({
  text: z.string().max(8000),
  image: z.string().max(4_000_000).optional(),
  conversationId: z.string().uuid().optional(),
  source: z.enum(["text", "voice", "screen"]).optional(),
  userText: z.string().max(4000).optional(),
  personality: z.string().max(40).optional(),
  detail: z.enum(["fast", "balanced", "deep"]).optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(20)
    .optional(),
});

const DETAIL: Record<string, string> = {
  fast: "\n\nResponse mode FAST: one short sentence, at most two. Name the exact thing to click and nothing else.",
  balanced: "",
  deep: "\n\nResponse mode DEEP: you may use up to 6 sentences. Give the next step, briefly why it matters, and what they should expect to see after.",
};

function fail(reason: string, status: number) {
  return Response.json({ ok: false, reason }, { status });
}

export const Route = createFileRoute("/api/melo-stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Verify the caller from their own session token; never trust the client.
        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (!token) return fail("unauthorized", 401);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: u, error: authErr } = await supabaseAdmin.auth.getUser(token);
        if (authErr || !u.user) return fail("unauthorized", 401);
        const userId = u.user.id;

        const parsed = input.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return fail("bad_request", 400);
        const data = parsed.data;

        const day = todayUtc();
        // all access checks run at once to save time
        const [{ data: entitled }, cfgRes, subRes, todayRes] = await Promise.all([
          supabaseAdmin.rpc("melo_entitled", { _user_id: userId }),
          supabaseAdmin.from("app_config").select("key, value").eq("key", "limits"),
          supabaseAdmin.from("subscriptions").select("subscription_status, trial_ends_at").eq("user_id", userId).maybeSingle(),
          supabaseAdmin.from("usage_daily").select("id, interactions, input_tokens, output_tokens").eq("user_id", userId).eq("day", day).maybeSingle(),
        ]);
        if (!entitled) return fail("trial_expired", 402);
        const limits = { ...DEFAULT_LIMITS, ...((cfgRes.data?.[0]?.value as object) ?? {}) } as LimitsConfig;
        const sub = subRes.data;
        const onTrial =
          sub?.subscription_status === "TRIALING" && !!sub.trial_ends_at && new Date(sub.trial_ends_at).getTime() > Date.now();
        const dailyLimit = onTrial ? limits.trial_daily_interactions : limits.pro_daily_interactions;
        if ((todayRes.data?.interactions ?? 0) >= dailyLimit) return fail("limit_reached", 429);

        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return fail("not_configured", 500);

        const detail = data.detail ?? "fast";
        const historyCount = detail === "fast" ? 6 : 10;
        const content: Record<string, unknown>[] = [{ type: "text", text: data.text }];
        if (data.image) content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${data.image}` } });

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: MODEL,
            stream: true,
            stream_options: { include_usage: true },
            messages: [
              { role: "system", content: SYSTEM + personaLine(data.personality) + DETAIL[detail] + "\n\nReply with plain spoken text only (no JSON)." },
              ...(data.history ?? []).slice(-historyCount),
              { role: "user", content },
            ],
          }),
          signal: request.signal,
        });

        if (!upstream.ok || !upstream.body) {
          console.error(`melo-stream failed [${upstream.status}]: ${await upstream.text().catch(() => "")}`);
          return fail(upstream.status === 429 ? "rate_limited" : upstream.status === 402 ? "credits" : "ai_error", upstream.status === 429 ? 429 : 502);
        }

        let full = "";
        let inTok = 0;
        let outTok = 0;
        let buf = "";
        const enc = new TextEncoder();
        const dec = new TextDecoder();

        const finalize = async () => {
          const reply = full.trim();
          await supabaseAdmin.from("usage_events").insert({
            user_id: userId,
            kind: data.image ? "screen" : "chat",
            model: MODEL,
            input_tokens: inTok,
            output_tokens: outTok,
          });
          if (todayRes.data) {
            await supabaseAdmin
              .from("usage_daily")
              .update({
                interactions: todayRes.data.interactions + 1,
                input_tokens: todayRes.data.input_tokens + inTok,
                output_tokens: todayRes.data.output_tokens + outTok,
                updated_at: new Date().toISOString(),
              })
              .eq("id", todayRes.data.id);
          } else {
            await supabaseAdmin.from("usage_daily").insert({ user_id: userId, day, interactions: 1, input_tokens: inTok, output_tokens: outTok });
          }
          if (!data.conversationId) return;
          const { data: conv } = await supabaseAdmin.from("conversations").select("id, title, user_id").eq("id", data.conversationId).maybeSingle();
          if (!conv || conv.user_id !== userId) return;
          const silent = !reply || reply.toUpperCase().startsWith("SKIP");
          if (data.source === "screen" && silent) return;
          const userContent = (data.userText || data.text).trim() || "…";
          const src = data.source ?? "text";
          const rows = [{ conversation_id: conv.id, user_id: userId, role: "user", content: userContent, source: src }];
          if (!silent) rows.push({ conversation_id: conv.id, user_id: userId, role: "assistant", content: reply, source: src });
          await supabaseAdmin.from("messages").insert(rows);
          await supabaseAdmin
            .from("conversations")
            .update({
              updated_at: new Date().toISOString(),
              model: MODEL,
              ...(src === "voice" ? { had_voice: true } : {}),
              ...(data.image ? { had_screen: true } : {}),
              ...(conv.title === "New chat" && src !== "screen" ? { title: userContent.slice(0, 60) } : {}),
            })
            .eq("id", conv.id);
        };

        // Forward only the reply text, token by token; save + count usage once it ends.
        const out = upstream.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, ctl) {
              buf += dec.decode(chunk, { stream: true });
              const lines = buf.split("\n");
              buf = lines.pop() ?? "";
              for (const line of lines) {
                const l = line.trim();
                if (!l.startsWith("data:")) continue;
                const payload = l.slice(5).trim();
                if (payload === "[DONE]") continue;
                try {
                  const j = JSON.parse(payload) as {
                    choices?: { delta?: { content?: string } }[];
                    usage?: { prompt_tokens?: number; completion_tokens?: number };
                  };
                  const d = j.choices?.[0]?.delta?.content;
                  if (d) {
                    full += d;
                    ctl.enqueue(enc.encode(d));
                  }
                  if (j.usage) {
                    inTok = j.usage.prompt_tokens ?? inTok;
                    outTok = j.usage.completion_tokens ?? outTok;
                  }
                } catch {
                  /* partial frame */
                }
              }
            },
            async flush() {
              try {
                await finalize();
              } catch (e) {
                console.error("melo-stream finalize failed", e);
              }
            },
          }),
        );

        return new Response(out, {
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
