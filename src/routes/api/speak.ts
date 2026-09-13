import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/speak")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) {
          return Response.json({ error: "Voice is not configured." }, { status: 500 });
        }

        const { text } = (await request.json()) as { text?: string };
        if (!text || !text.trim()) {
          return Response.json({ error: "Nothing to say." }, { status: 400 });
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
            voice: "alloy",
            instructions: "Speak warmly, calmly and clearly, like a patient guide.",
            response_format: "mp3",
            stream_format: "audio",
          }),
        });

        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          console.error(`Speech failed [${res.status}]: ${detail}`);
          return Response.json({ error: "Could not generate the voice." }, { status: res.status });
        }

        return new Response(res.body, {
          headers: { "Content-Type": "audio/mpeg" },
        });
      },
    },
  },
});
