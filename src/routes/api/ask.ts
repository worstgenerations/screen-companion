import { createFileRoute } from "@tanstack/react-router";

type Turn = { role: "user" | "assistant"; content: string };

const SYSTEM = `You are Aura, a friendly spoken voice assistant that guides people step by step through practical tasks: setting up a data pipeline, opening an online store, installing software, fixing a setting, anything.

Rules for every reply:
- You are being SPOKEN ALOUD. Keep it short: 2-4 sentences max.
- Give ONE concrete step at a time, then ask "ready for the next one?" style follow-up.
- No markdown, no bullet points, no code blocks, no URLs read out character by character.
- Be warm, calm and direct. Never mention that you are an AI model.`;

export const Route = createFileRoute("/api/ask")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) {
          return Response.json({ error: "Assistant is not configured." }, { status: 500 });
        }

        const body = (await request.json()) as {
          audio?: string;
          format?: string;
          text?: string;
          history?: Turn[];
        };

        const history = Array.isArray(body.history) ? body.history.slice(-10) : [];

        const userContent = body.audio
          ? [
              {
                type: "text",
                text: "Listen to this and answer it as spoken guidance. Reply with JSON only: {\"heard\": \"<what the person said>\", \"reply\": \"<your spoken answer>\"}",
              },
              {
                type: "input_audio",
                input_audio: { data: body.audio, format: body.format || "webm" },
              },
            ]
          : [
              {
                type: "text",
                text: `The person typed: ${body.text ?? ""}\n\nReply with JSON only: {"heard": "<what they asked>", "reply": "<your spoken answer>"}`,
              },
            ];

        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "google/gemini-3.8-flash",
            messages: [
              { role: "system", content: SYSTEM },
              ...history.map((t) => ({ role: t.role, content: t.content })),
              { role: "user", content: userContent },
            ],
            response_format: { type: "json_object" },
          }),
        });

        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          console.error(`Ask failed [${res.status}]: ${detail}`);
          const message =
            res.status === 429
              ? "Too many requests right now — give it a few seconds and try again."
              : res.status === 402
                ? "The AI credits for this app have run out."
                : "Something went wrong reaching the assistant.";
          return Response.json({ error: message }, { status: res.status });
        }

        const data = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const raw = data.choices?.[0]?.message?.content ?? "";

        let heard = "";
        let reply = raw.trim();
        try {
          const parsed = JSON.parse(raw) as { heard?: string; reply?: string };
          heard = parsed.heard ?? "";
          reply = parsed.reply ?? reply;
        } catch {
          // keep raw text as the reply
        }

        if (!reply) reply = "I didn't quite catch that. Could you say it again?";

        return Response.json({ heard, reply });
      },
    },
  },
});
