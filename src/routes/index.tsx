import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square, Loader2, Volume2 } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Aura — Your Spoken Step-by-Step Guide" },
      {
        name: "description",
        content:
          "Tap the orb, say what you need help with, and Aura talks you through it one step at a time.",
      },
      { property: "og:title", content: "Aura — Your Spoken Step-by-Step Guide" },
      {
        property: "og:description",
        content:
          "Tap the orb, say what you need help with, and Aura talks you through it one step at a time.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Mode = "idle" | "listening" | "thinking" | "speaking";
type Turn = { role: "user" | "assistant"; content: string };

function Index() {
  const [mode, setMode] = useState<Mode>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const speak = useCallback(async (text: string) => {
    setMode("speaking");
    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("voice");
      const blob = await res.blob();
      const audio = new Audio(URL.createObjectURL(blob));
      audioRef.current = audio;
      audio.onended = () => setMode("idle");
      await audio.play();
    } catch {
      setMode("idle");
    }
  }, []);

  const send = useCallback(
    async (payload: { audio?: string; format?: string; text?: string }) => {
      setMode("thinking");
      setError(null);
      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, history: turnsRef.current.slice(-10) }),
        });
        const data = (await res.json()) as { heard?: string; reply?: string; error?: string };
        if (!res.ok || data.error) throw new Error(data.error || "failed");

        const heard = data.heard?.trim() || payload.text?.trim() || "…";
        setTurns((prev) => [
          ...prev,
          { role: "user", content: heard },
          { role: "assistant", content: data.reply! },
        ]);
        await speak(data.reply!);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
        setMode("idle");
      }
    },
    [speak],
  );

  const startListening = useCallback(async () => {
    setError(null);
    audioRef.current?.pause();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        if (blob.size < 1200) {
          setMode("idle");
          setError("I didn't hear anything — hold on a little longer next time.");
          return;
        }
        const buf = await blob.arrayBuffer();
        let binary = "";
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        const format = recorder.mimeType.includes("mp4") ? "m4a" : "webm";
        await send({ audio: btoa(binary), format });
      };
      recorderRef.current = recorder;
      recorder.start();
      setMode("listening");
    } catch {
      setError("I need microphone access to listen. Allow it and tap the orb again.");
    }
  }, [send]);

  const onOrbClick = useCallback(() => {
    if (mode === "listening") {
      recorderRef.current?.stop();
      setMode("thinking");
    } else if (mode === "speaking") {
      audioRef.current?.pause();
      setMode("idle");
    } else if (mode === "idle") {
      void startListening();
    }
  }, [mode, startListening]);

  const label =
    mode === "listening"
      ? "Listening — tap when you're done"
      : mode === "thinking"
        ? "Thinking it through…"
        : mode === "speaking"
          ? "Speaking — tap to stop"
          : turns.length
            ? "Tap to ask the next thing"
            : "Tap and ask me anything";

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-aura-field" aria-hidden="true" />

      <div className="relative mx-auto flex min-h-screen max-w-2xl flex-col items-center px-6 py-14">
        <header className="text-center">
          <h1 className="font-display text-4xl tracking-tight sm:text-5xl">Aura</h1>
          <p className="mt-3 max-w-md text-balance text-sm text-muted-foreground">
            Say what you're trying to do — set up a pipeline, open a store, fix a setting — and
            I'll walk you through it out loud, one step at a time.
          </p>
        </header>

        <button
          type="button"
          onClick={onOrbClick}
          aria-label={label}
          className="group relative my-12 grid size-56 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
        >
          <span className={`orb orb-${mode}`} />
          <span className="relative z-10 text-aura-glyph">
            {mode === "thinking" ? (
              <Loader2 className="size-9 animate-spin" />
            ) : mode === "speaking" ? (
              <Volume2 className="size-9" />
            ) : mode === "listening" ? (
              <Square className="size-8 fill-current" />
            ) : (
              <Mic className="size-9" />
            )}
          </span>
        </button>

        <p className="text-sm font-medium tracking-wide text-muted-foreground">{label}</p>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <section className="mt-12 w-full space-y-5 pb-16" aria-live="polite">
          {turns.map((turn, i) => (
            <div
              key={i}
              className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              {turn.role === "user" ? (
                <p className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                  {turn.content}
                </p>
              ) : (
                <p className="max-w-[85%] text-base leading-relaxed text-foreground">
                  {turn.content}
                </p>
              )}
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
