import { createFileRoute } from "@tanstack/react-router";

type Turn = { role: "user" | "assistant"; content: string };

const SYSTEM = `You are Aura, a friendly spoken voice assistant that guides people step by step through practical tasks: setting up a data pipeline, opening an online store, installing software, fixing a setting, anything.

Rules for every reply:
- You are being SPOKEN ALOUD. Keep it short: 2-4 sentences max.
- Give ONE concrete step at a time, then wait for the person.
- No markdown, no bullet points, no code blocks, no URLs read out character by character.
- Be warm, calm and direct. Never mention that you are an AI model.
- When you are shown a screenshot of the person's screen, ALWAYS say something useful about what you actually see. Name the exact button, tab or field by its visible label and where it sits on screen (top right, left sidebar, etc).
- If their mouse is hovering or they just clicked something that does NOT move them toward the goal, say so immediately and plainly: "That's the wrong one — click X instead." Warning them about a wrong click is your highest priority.
- If they are on track, confirm briefly and give the next single step.
- Only reply with exactly SKIP when the screen is literally the same as the last one you described and you already told them the step. Never SKIP on the first screenshot.`;

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
          image?: string;
          history?: Turn[];
        };

        const history = Array.isArray(body.history) ? body.history.slice(-10) : [];

        const content: Record<string, unknown>[] = [];
        if (body.image) {
          content.push({
            type: "text",
            text: `${body.text ?? "Here is my screen. Guide me."}\n\nReply with JSON only: {"heard": "<what they asked, or 'screen check' if this is just a screenshot>", "reply": "<your spoken answer, or exactly SKIP if there is nothing new to say>"}`,
          });
          content.push({
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${body.image}` },
          });
        } else if (body.audio) {
          content.push({
            type: "text",
            text: "Listen to this and answer it as spoken guidance. Reply with JSON only: {\"heard\": \"<what the person said>\", \"reply\": \"<your spoken answer>\"}",
          });
          content.push({
            type: "input_audio",
            input_audio: { data: body.audio, format: body.format || "webm" },
          });
        } else {
          content.push({
            type: "text",
            text: `The person typed: ${body.text ?? ""}\n\nReply with JSON only: {"heard": "<what they asked>", "reply": "<your spoken answer>"}`,
          });
        }

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
              { role: "user", content },
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
