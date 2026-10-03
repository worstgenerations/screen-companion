import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Turn = { role: "user" | "assistant"; content: string };

type ProductConfig = {
  name: string;
  plan: string;
  price_cents: number;
  currency: string;
  trial_days: number;
};

type LimitsConfig = {
  trial_daily_interactions: number;
  pro_daily_interactions: number;
  trial_daily_ai_seconds: number;
  pro_daily_ai_seconds: number;
};

const DEFAULT_PRODUCT: ProductConfig = {
  name: "Melo AI",
  plan: "melo_pro",
  price_cents: 900,
  currency: "usd",
  trial_days: 7,
};

const DEFAULT_LIMITS: LimitsConfig = {
  trial_daily_interactions: 60,
  pro_daily_interactions: 500,
  trial_daily_ai_seconds: 1800,
  pro_daily_ai_seconds: 14400,
};

const SYSTEM = `You are Melo, a friendly spoken voice assistant that guides people step by step through practical tasks: setting up a data pipeline, opening an online store, installing software, fixing a setting, anything.

Rules for every reply:
- You are being SPOKEN ALOUD. Keep it short: 2-4 sentences max.
- Give ONE concrete step at a time, then wait for the person.
- No markdown, no bullet points, no code blocks, no URLs read out character by character.
- Be warm, calm and direct. Never mention that you are an AI model.
- When you are shown a screenshot of the person's screen, ALWAYS say something useful about what you actually see. Name the exact button, tab or field by its visible label and where it sits on screen (top right, left sidebar, etc).
- If their mouse is hovering or they just clicked something that does NOT move them toward the goal, say so immediately and plainly: "That's the wrong one — click X instead." Warning them about a wrong click is your highest priority.
- If they are on track, confirm briefly and give the next single step.
- Only reply with exactly SKIP when the screen is literally the same as the last one you described and you already told them the step. Never SKIP on the first screenshot.`;

const PERSONAS: Record<string, string> = {
  classic: "",
  playful: "Personality: playful, upbeat and energetic, with light humor.",
  cute: "Personality: cute and expressive, cheerful encouragement.",
  commander: "Personality: firm, direct and authoritative, like a calm drill instructor. Very concise.",
  mentor: "Personality: calm, patient mentor who briefly explains why each step matters.",
  savage: "Personality: sarcastic and blunt but still genuinely helpful. Never insulting about the person.",
};
function personaLine(p?: string) {
  const line = p ? PERSONAS[p] : "";
  return line ? `\n\n${line}` : "";
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

export const getAccountState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const day = todayUtc();

    const [subRes, productRes, limitsRes, todayRes, adminRes, profileRes] = await Promise.all([
      supabase.from("subscriptions").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("app_config").select("value").eq("key", "product").maybeSingle(),
      supabase.from("app_config").select("value").eq("key", "limits").maybeSingle(),
      supabase
        .from("usage_daily")
        .select("interactions, ai_seconds, input_tokens, output_tokens")
        .eq("user_id", userId)
        .eq("day", day)
        .maybeSingle(),
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.from("profiles").select("full_name, email").eq("id", userId).maybeSingle(),
    ]);

    const product = { ...DEFAULT_PRODUCT, ...((productRes.data?.value as object) ?? {}) } as ProductConfig;
    const limits = { ...DEFAULT_LIMITS, ...((limitsRes.data?.value as object) ?? {}) } as LimitsConfig;

    const sub = subRes.data;
    const now = Date.now();
    const trialEndsAt = sub?.trial_ends_at ?? null;
    const trialActive =
      sub?.subscription_status === "TRIALING" && trialEndsAt
        ? new Date(trialEndsAt).getTime() > now
        : false;
    const active =
      sub?.subscription_status === "ACTIVE" ||
      (sub?.subscription_status === "PAST_DUE" &&
        sub.current_period_end !== null &&
        new Date(sub.current_period_end).getTime() > now);

    const effectiveStatus = !sub
      ? "NONE"
      : active
        ? "ACTIVE"
        : trialActive
          ? "TRIALING"
          : sub.subscription_status === "TRIALING"
            ? "EXPIRED"
            : sub.subscription_status;

    const trialDaysLeft = trialActive
      ? Math.max(0, Math.ceil((new Date(trialEndsAt!).getTime() - now) / 86_400_000))
      : 0;

    const dailyLimit = trialActive ? limits.trial_daily_interactions : limits.pro_daily_interactions;

    return {
      email: profileRes.data?.email ?? null,
      fullName: profileRes.data?.full_name ?? null,
      isAdmin: adminRes.data === true,
      status: effectiveStatus as string,
      entitled: active || trialActive,
      plan: sub?.plan ?? product.plan,
      priceCents: sub?.price_cents ?? product.price_cents,
      currency: sub?.currency ?? product.currency,
      trialDays: product.trial_days,
      trialDaysLeft,
      trialEndsAt,
      cancelAtPeriodEnd: sub?.cancel_at_period_end ?? false,
      usageToday: {
        interactions: todayRes.data?.interactions ?? 0,
        aiSeconds: todayRes.data?.ai_seconds ?? 0,
        dailyLimit,
      },
    };
  });

const askInput = z.object({
  text: z.string().max(4000).optional(),
  image: z.string().max(8_000_000).optional(),
  audio: z.string().max(12_000_000).optional(),
  format: z.string().max(10).optional(),
  conversationId: z.string().uuid().optional(),
  source: z.enum(["text", "voice", "screen"]).optional(),
  userText: z.string().max(4000).optional(),
  personality: z.string().max(40).optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(20)
    .optional(),
});

export const meloAsk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => askInput.parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Server-side entitlement: trial active or paid plan.
    const { data: entitled } = await supabaseAdmin.rpc("melo_entitled", { _user_id: userId });
    if (!entitled) {
      return { ok: false as const, reason: "trial_expired" as const };
    }

    // 2. Config + today's usage -> enforce the daily interaction cap server-side.
    const day = todayUtc();
    const [cfgRes, subRes, todayRes] = await Promise.all([
      supabaseAdmin.from("app_config").select("key, value").in("key", ["product", "limits"]),
      supabaseAdmin
        .from("subscriptions")
        .select("subscription_status, trial_ends_at")
        .eq("user_id", userId)
        .maybeSingle(),
      supabaseAdmin
        .from("usage_daily")
        .select("id, interactions, ai_seconds, input_tokens, output_tokens")
        .eq("user_id", userId)
        .eq("day", day)
        .maybeSingle(),
    ]);

    const cfg = Object.fromEntries((cfgRes.data ?? []).map((r) => [r.key, r.value]));
    const limits = { ...DEFAULT_LIMITS, ...((cfg["limits"] as object) ?? {}) } as LimitsConfig;

    const sub = subRes.data;
    const onTrial =
      sub?.subscription_status === "TRIALING" &&
      sub.trial_ends_at !== null &&
      new Date(sub.trial_ends_at).getTime() > Date.now();
    const dailyLimit = onTrial ? limits.trial_daily_interactions : limits.pro_daily_interactions;

    const usedToday = todayRes.data?.interactions ?? 0;
    if (usedToday >= dailyLimit) {
      return { ok: false as const, reason: "limit_reached" as const, limit: dailyLimit };
    }

    // 3. Call the AI.
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) return { ok: false as const, reason: "not_configured" as const };

    const history = (data.history ?? []).slice(-10);
    const content: Record<string, unknown>[] = [];
    if (data.audio && data.image) {
      content.push({
        type: "text",
        text: `${data.text ?? "Listen to the audio and answer it using the screenshot."}\n\nReply with JSON only: {"heard": "<what the person said>", "reply": "<your spoken answer>"}`,
      });
      content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${data.image}` } });
      content.push({ type: "input_audio", input_audio: { data: data.audio, format: data.format || "webm" } });
    } else if (data.image) {
      content.push({
        type: "text",
        text: `${data.text ?? "Here is my screen. Guide me."}\n\nReply with JSON only: {"heard": "<what they asked, or 'screen check' if this is just a screenshot>", "reply": "<your spoken answer, or exactly SKIP if there is nothing new to say>"}`,
      });
      content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${data.image}` } });
    } else if (data.audio) {
      content.push({
        type: "text",
        text: 'Listen to this and answer it as spoken guidance. Reply with JSON only: {"heard": "<what the person said>", "reply": "<your spoken answer>"}',
      });
      content.push({ type: "input_audio", input_audio: { data: data.audio, format: data.format || "webm" } });
    } else {
      content.push({
        type: "text",
        text: `The person typed: ${data.text ?? ""}\n\nReply with JSON only: {"heard": "<what they asked>", "reply": "<your spoken answer>"}`,
      });
    }

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-3.8-flash",
        messages: [
          { role: "system", content: SYSTEM + personaLine(data.personality) },
          ...history.map((t: Turn) => ({ role: t.role, content: t.content })),
          { role: "user", content },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      console.error(`Melo ask failed [${res.status}]: ${await res.text().catch(() => "")}`);
      return {
        ok: false as const,
        reason: res.status === 429 ? ("rate_limited" as const) : ("ai_error" as const),
      };
    }

    const ai = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const raw = ai.choices?.[0]?.message?.content ?? "";
    let heard = "";
    let reply = raw.trim();
    try {
      const parsed = JSON.parse(raw) as { heard?: string; reply?: string };
      heard = parsed.heard ?? "";
      reply = parsed.reply ?? reply;
    } catch {
      /* keep raw */
    }
    if (!reply) reply = "I didn't quite catch that. Could you say it again?";

    // 4. Usage tracking (server-side, admin client).
    const inputTokens = ai.usage?.prompt_tokens ?? 0;
    const outputTokens = ai.usage?.completion_tokens ?? 0;
    await supabaseAdmin.from("usage_events").insert({
      user_id: userId,
      kind: data.audio ? "voice" : data.image ? "screen" : "chat",
      model: "google/gemini-3.8-flash",
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    });
    if (todayRes.data) {
      await supabaseAdmin
        .from("usage_daily")
        .update({
          interactions: todayRes.data.interactions + 1,
          input_tokens: todayRes.data.input_tokens + inputTokens,
          output_tokens: todayRes.data.output_tokens + outputTokens,
          updated_at: new Date().toISOString(),
        })
        .eq("id", todayRes.data.id);
    } else {
      await supabaseAdmin.from("usage_daily").insert({
        user_id: userId,
        day,
        interactions: 1,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      });
    }

    // 5. Persist the exchange to the conversation (ownership verified).
    if (data.conversationId) {
      const { data: conv } = await supabaseAdmin
        .from("conversations")
        .select("id, title, user_id")
        .eq("id", data.conversationId)
        .maybeSingle();
      if (conv && conv.user_id === userId) {
        const userContent = (data.userText || heard || data.text || "").trim() || "…";
        const silent = reply.trim().toUpperCase().startsWith("SKIP");
        const rows = [
          { conversation_id: conv.id, user_id: userId, role: "user", content: userContent, source: data.source ?? "text" },
        ];
        if (!silent) rows.push({ conversation_id: conv.id, user_id: userId, role: "assistant", content: reply, source: data.source ?? "text" });
        const { error: msgErr } = await supabaseAdmin.from("messages").insert(rows);
        if (msgErr) console.error("message save failed", msgErr);
        await supabaseAdmin
          .from("conversations")
          .update({
            updated_at: new Date().toISOString(),
            model: "google/gemini-3.8-flash",
            ...(data.source === "voice" ? { had_voice: true } : {}),
            ...(data.image ? { had_screen: true } : {}),
            ...(conv.title === "New chat" ? { title: userContent.slice(0, 60) } : {}),
          })
          .eq("id", conv.id);
      }
    }

    return {
      ok: true as const,
      heard,
      reply,
      usage: { interactionsToday: usedToday + 1, dailyLimit },
    };
  });

export const getAdminStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const day = todayUtc();

    const [subsRes, usageTodayRes, recentRes] = await Promise.all([
      supabaseAdmin.from("subscriptions").select("subscription_status, user_id, trial_ends_at"),
      supabaseAdmin
        .from("usage_daily")
        .select("interactions, ai_seconds, input_tokens, output_tokens, user_id")
        .eq("day", day),
      supabaseAdmin
        .from("profiles")
        .select("id, email, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    const subs = subsRes.data ?? [];
    const now = Date.now();
    const byStatus: Record<string, number> = {};
    for (const s of subs) {
      const effective =
        s.subscription_status === "TRIALING" &&
        s.trial_ends_at !== null &&
        new Date(s.trial_ends_at).getTime() <= now
          ? "EXPIRED"
          : s.subscription_status;
      byStatus[effective] = (byStatus[effective] ?? 0) + 1;
    }

    const usageToday = usageTodayRes.data ?? [];
    return {
      totalUsers: subs.length,
      byStatus,
      today: {
        interactions: usageToday.reduce((a, r) => a + r.interactions, 0),
        activeUsers: new Set(usageToday.map((r) => r.user_id)).size,
        inputTokens: usageToday.reduce((a, r) => a + r.input_tokens, 0),
        outputTokens: usageToday.reduce((a, r) => a + r.output_tokens, 0),
      },
      recentSignups: (recentRes.data ?? []).map((p) => ({
        email: p.email,
        createdAt: p.created_at,
      })),
    };
  });
