import { createFileRoute } from "@tanstack/react-router";

// Allow the Chrome extension side panel to generate voice directly.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export const Route = createFileRoute("/api/speak")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) {
          return Response.json({ error: "Voice is not configured." }, { status: 500, headers: CORS });
        }

        const { text } = (await request.json()) as { text?: string };
        if (!text || !text.trim()) {
          return Response.json({ error: "Nothing to say." }, { status: 400, headers: CORS });
        }

        const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "openai/gpt-4o-mini-tts",
            input: text.slice(0, 4000),
            voice: "nova",
            instructions: "Natural, warm, conversational and upbeat, like a friendly expert sitting next to the person. Clear and confident, not robotic.",
            response_format: "mp3",
            stream_format: "audio",
          }),
        });

        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          console.error(`Speech failed [${res.status}]: ${detail}`);
          return Response.json({ error: "Could not generate the voice." }, { status: res.status, headers: CORS });
        }

        return new Response(res.body, {
          headers: { "Content-Type": "audio/mpeg", ...CORS },
        });
      },
    },
  },
});
