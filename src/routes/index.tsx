import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Mic,
  Square,
  Loader2,
  Volume2,
  MonitorPlay,
  MonitorOff,
  SendHorizontal,
} from "lucide-react";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Aura — Sees Your Screen, Talks You Through It" },
      {
        name: "description",
        content:
          "Share your screen with Aura and it watches what you're doing, then speaks live step-by-step guidance out loud.",
      },
      { property: "og:title", content: "Aura — Sees Your Screen, Talks You Through It" },
      {
        property: "og:description",
        content:
          "Share your screen with Aura and it watches what you're doing, then speaks live step-by-step guidance out loud.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Mode = "idle" | "listening" | "thinking" | "speaking";
type Turn = { role: "user" | "assistant"; content: string };

const FRAME_INTERVAL_MS = 1500;
const CHANGE_THRESHOLD = 2.5; // mean pixel difference to count as "screen changed"

function Index() {
  const [mode, setMode] = useState<Mode>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [goal, setGoal] = useState("");
  const [chat, setChat] = useState("");


  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const watchStreamRef = useRef<MediaStream | null>(null);
  const watchTimerRef = useRef<number | null>(null);
  const lastFrameRef = useRef<Uint8ClampedArray | null>(null);
  const busyRef = useRef(false);
  const speakingRef = useRef(false);
  const goalRef = useRef("");
  goalRef.current = goal;
  const chatRef = useRef("");
  chatRef.current = chat;

  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;

  const stopWatching = useCallback(() => {
    if (watchTimerRef.current !== null) {
      window.clearInterval(watchTimerRef.current);
      watchTimerRef.current = null;
    }
    watchStreamRef.current?.getTracks().forEach((t) => t.stop());
    watchStreamRef.current = null;
    lastFrameRef.current = null;
    setWatching(false);
  }, []);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
      stopWatching();
    };
  }, [stopWatching]);

  const speakRemote = useCallback(async (text: string) => {
    const res = await fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error("voice");
    const blob = await res.blob();
    const audio = new Audio(URL.createObjectURL(blob));
    audioRef.current = audio;
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      void audio.play().catch(() => resolve());
    });
  }, []);

  const speak = useCallback(
    async (text: string) => {
      setMode("speaking");
      speakingRef.current = true;
      try {
        const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
        if (synth) {
          // Instant, local voice — no network round trip.
          synth.cancel();
          await new Promise<void>((resolve) => {
            const u = new SpeechSynthesisUtterance(text);
            u.rate = 1.05;
            u.onend = () => resolve();
            u.onerror = () => resolve();
            synth.speak(u);
          });
        } else {
          await speakRemote(text);
        }
      } catch {
        /* stay silent rather than break the loop */
      } finally {
        speakingRef.current = false;
        setMode("idle");
      }
    },
    [speakRemote],
  );

  const send = useCallback(
    async (payload: { audio?: string; format?: string; text?: string; image?: string }) => {
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

        const reply = data.reply!.trim();
        const silent = reply.toUpperCase().startsWith("SKIP");
        const heard = data.heard?.trim() || payload.text?.trim() || "…";
        setTurns((prev) => [
          ...prev,
          { role: "user", content: heard },
          { role: "assistant", content: silent ? "…" : reply },
        ]);
        if (!silent) void speak(reply);
        else setMode("idle");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
        setMode("idle");
      }
    },
    [speak],
  );

  const grabFrame = useCallback(async () => {
    const stream = watchStreamRef.current;
    if (!stream) return null;
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState !== "live") return null;

    const video = document.createElement("video");
    video.muted = true;
    video.srcObject = new MediaStream([track]);
    await video.play().catch(() => {});
    if (!video.videoWidth) {
      video.srcObject = null;
      return null;
    }

    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1024 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    video.pause();
    video.srcObject = null;
    return canvas;
  }, []);

  const captureFrame = useCallback(async () => {
    if (busyRef.current) return;
    const canvas = await grabFrame();
    if (!canvas) return;

    // Change detection on a tiny downsample
    const small = document.createElement("canvas");
    small.width = 64;
    small.height = 36;
    const sctx = small.getContext("2d")!;
    sctx.drawImage(canvas, 0, 0, 64, 36);
    const pixels = sctx.getImageData(0, 0, 64, 36).data;
    const last = lastFrameRef.current;
    lastFrameRef.current = pixels;
    if (last) {
      let diff = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        diff += Math.abs(pixels[i]! - last[i]!);
      }
      const mean = diff / (pixels.length / 4);
      if (mean < CHANGE_THRESHOLD) return; // nothing changed, skip the call
    }

    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    const image = dataUrl.split(",")[1];
    if (!image) return;

    busyRef.current = true;
    try {
      const g = goalRef.current.trim();
      await send({
        image,
        text: g
          ? `My goal is: ${g}. Here is my screen right now — tell me the next one step, or SKIP if nothing changed that needs a reaction.`
          : `Here is my screen right now. Guide me on what you see, or SKIP if nothing needs a reaction.`,
      });
    } finally {
      busyRef.current = false;
    }
  }, [grabFrame, send]);

  const sendChat = useCallback(async () => {
    const text = chatRef.current.trim();
    if (!text || busyRef.current) return;
    setChat("");
    busyRef.current = true;
    try {
      const canvas = await grabFrame();
      const image = canvas ? canvas.toDataURL("image/jpeg", 0.7).split(",")[1] : undefined;
      const g = goalRef.current.trim();
      await send({
        ...(image ? { image } : {}),

        text: image
          ? `${g ? `My goal is: ${g}. ` : ""}Here is my screen right now. I'm asking you: ${text}. Answer me directly — never reply SKIP to a question I typed.`
          : text,
      });
    } finally {
      busyRef.current = false;
    }
  }, [grabFrame, send]);


  const startWatching = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      watchStreamRef.current = stream;
      stream.getVideoTracks()[0]?.addEventListener("ended", stopWatching);
      setWatching(true);
      lastFrameRef.current = null;
      void captureFrame(); // first frame right away
      watchTimerRef.current = window.setInterval(() => void captureFrame(), FRAME_INTERVAL_MS);
    } catch {
      setError("Screen sharing was cancelled. Tap “Watch my screen” and pick the screen to share.");
    }
  }, [captureFrame, stopWatching]);

  const startListening = useCallback(async () => {
    setError(null);
    audioRef.current?.pause();
    speakingRef.current = false;
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
        // If we're watching, attach a fresh frame so the answer matches the screen.
        const canvas = watchStreamRef.current ? await grabFrame() : null;
        const image = canvas ? canvas.toDataURL("image/jpeg", 0.7).split(",")[1] : undefined;
        const buf = await blob.arrayBuffer();
        let binary = "";
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        const format = recorder.mimeType.includes("mp4") ? "m4a" : "webm";
        const g = goalRef.current.trim();
        await send({
          audio: btoa(binary),
          format,
          ...(image ? { image } : {}),
          ...(image
            ? {
                text: `${g ? `My goal is: ${g}. ` : ""}Here is my screen right now. Listen to the audio of what I said, then answer it using what you see — never reply SKIP to something I said.`,
              }
            : {}),
        });
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
      speakingRef.current = false;
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
          : watching
            ? "Watching your screen…"
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
            Share your screen and tell me your goal — I'll watch what you're doing and talk you
            through it out loud, one step at a time.
          </p>
        </header>

        <button
          type="button"
          onClick={onOrbClick}
          aria-label={label}
          className="group relative my-12 grid size-56 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
        >
          <span className="orb-stage" data-mode={mode}>
            <span className="orb-swirl orb-swirl-1" />
            <span className="orb-swirl orb-swirl-2" />
            <span className="orb-swirl orb-swirl-3" />
            <span className="orb-glass" />
            <span className="orb-ring orb-ring-1" />
            <span className="orb-ring orb-ring-2" />
          </span>

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

        <div className="mt-8 flex w-full max-w-md flex-col items-center gap-3">
          <input
            type="text"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Your goal, e.g. help me open a Shopify store"
            className="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="button"
            onClick={watching ? stopWatching : startWatching}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {watching ? (
              <>
                <MonitorOff className="size-4" /> Stop watching
              </>
            ) : (
              <>
                <MonitorPlay className="size-4" /> Watch my screen
              </>
            )}
          </button>
          {watching && (
            <p className="text-xs text-muted-foreground">
              Keep this tab open — you can switch to any other window and I'll still see the screen
              you shared.
            </p>
          )}
        </div>

        <section className="mt-12 w-full space-y-5 pb-4" aria-live="polite">
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

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendChat();
          }}
          className="sticky bottom-4 mt-auto flex w-full items-end gap-2 rounded-2xl border border-border bg-card/90 p-2 backdrop-blur"
        >
          <textarea
            value={chat}
            onChange={(e) => setChat(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendChat();
              }
            }}
            rows={1}
            placeholder={watching ? "Type instead of talking — I can see your screen" : "Type a message…"}
            className="max-h-32 flex-1 resize-none bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            type="submit"
            aria-label="Send message"
            disabled={!chat.trim() || mode === "thinking"}
            className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <SendHorizontal className="size-4" />
          </button>
        </form>

      </div>
    </main>
  );
}
