import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  Mic,
  MicOff,
  Loader2,
  Volume2,
  MonitorUp,
  MonitorX,
  ArrowUp,
  Plus,
  Search,
  Star,
  Folder,
  FolderPlus,
  Settings,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  PanelLeft,
  Pin,
} from "lucide-react";

import { meloAsk } from "@/lib/melo.functions";
import {
  listWorkspace,
  getMessages,
  createConversation,
  updateConversation,
  deleteConversation,
  saveProject,
  deleteProject,
} from "@/lib/workspace.functions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/melo")({
  validateSearch: z.object({ c: z.string().uuid().optional() }),
  head: () => ({
    meta: [
      { title: "Melo — Workspace" },
      { name: "description", content: "Share your screen, talk naturally, and let Melo guide you step by step." },
    ],
  }),
  component: Workspace,
});

type Mode = "idle" | "listening" | "thinking" | "speaking";
type Turn = { id: string; role: "user" | "assistant"; content: string };

const PERSONALITIES = [
  { id: "classic", name: "Classic Melo", desc: "Friendly · calm" },
  { id: "playful", name: "Playful Melo", desc: "Energetic · upbeat" },
  { id: "cute", name: "Anime Melo", desc: "Cute · expressive" },
  { id: "commander", name: "Commander Melo", desc: "Strict · direct" },
  { id: "mentor", name: "Mentor Melo", desc: "Patient · explains why" },
  { id: "savage", name: "Savage Melo", desc: "Sarcastic · blunt" },
] as const;
const VOICE_TUNING: Record<string, { rate: number; pitch: number }> = {
  classic: { rate: 1.05, pitch: 1 },
  playful: { rate: 1.15, pitch: 1.25 },
  cute: { rate: 1.1, pitch: 1.5 },
  commander: { rate: 1, pitch: 0.7 },
  mentor: { rate: 0.95, pitch: 0.95 },
  savage: { rate: 1.1, pitch: 0.9 },
};

const FILLER = /^(uh+|um+|hmm+|mm+|okay|ok|yeah|yep|yes|no|right|cool|alright|ah+|oh+|huh|so|well|thanks|thank you)[.!?, ]*$/i;
const MEANINGFUL_CHANGE = 8; // mean pixel diff for an automatic "screen changed" check-in
const AUTO_CHECK_MIN_GAP_MS = 12000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SR = any;

function Workspace() {
  const { c: convId } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const fetchWs = useServerFn(listWorkspace);
  const fetchMsgs = useServerFn(getMessages);
  const newConv = useServerFn(createConversation);
  const patchConv = useServerFn(updateConversation);
  const delConv = useServerFn(deleteConversation);
  const putProject = useServerFn(saveProject);
  const delProject = useServerFn(deleteProject);
  const ask = useServerFn(meloAsk);

  const ws = useQuery({ queryKey: ["workspace"], queryFn: () => fetchWs() });
  const msgs = useQuery({
    queryKey: ["messages", convId],
    queryFn: () => fetchMsgs({ data: { id: convId! } }),
    enabled: !!convId,
  });

  const [turns, setTurns] = useState<Turn[]>([]);
  useEffect(() => {
    if (!convId) setTurns([]);
    else if (msgs.data) setTurns(msgs.data.map((m) => ({ id: m.id, role: m.role as Turn["role"], content: m.content })));
  }, [convId, msgs.data]);

  const [mode, setMode] = useState<Mode>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [interim, setInterim] = useState("");
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [personality, setPersonality] = useState("classic");
  const [stats, setStats] = useState({ captured: 0, sent: 0 });

  const convRef = useRef(convId);
  convRef.current = convId;
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const personaRef = useRef(personality);
  personaRef.current = personality;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const recRef = useRef<SR>(null);
  const micWantedRef = useRef(false);
  const busyRef = useRef(false);
  const replyRef = useRef("");
  const lastThumbRef = useRef<Uint8ClampedArray | null>(null);
  const lastAutoRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("melo-personality") : null;
    if (saved) setPersonality(saved);
  }, []);

  // ---------- screen ----------
  const grabFrame = useCallback((): string | undefined => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return undefined;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1024 / v.videoWidth);
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7).split(",")[1];
  }, []);

  const stopSharing = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    lastThumbRef.current = null;
    setSharing(false);
  }, []);

  const startSharing = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      streamRef.current = stream;
      stream.getVideoTracks()[0]?.addEventListener("ended", stopSharing);
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play().catch(() => {});
      setSharing(true);
      setPanelOpen(true);
    } catch {
      setError("Screen sharing was cancelled.");
    }
  }, [stopSharing]);

  // ---------- speech out ----------
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speakTokenRef = useRef(0);
  const speakWatchRef = useRef<number | null>(null);

  const haltAudio = useCallback(() => {
    speakTokenRef.current++;
    if (speakWatchRef.current) window.clearTimeout(speakWatchRef.current);
    speakWatchRef.current = null;
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.src = "";
    }
    audioRef.current = null;
    window.speechSynthesis?.cancel();
  }, []);

  const stopSpeaking = useCallback(() => {
    haltAudio();
    replyRef.current = "";
    if (modeRef.current === "speaking") setMode(micWantedRef.current ? "listening" : "idle");
  }, [haltAudio]);

  const speak = useCallback(
    async (text: string) => {
      haltAudio();
      const token = speakTokenRef.current;
      replyRef.current = text.toLowerCase();
      setMode("speaking");
      const done = () => {
        if (token !== speakTokenRef.current) return;
        if (speakWatchRef.current) window.clearTimeout(speakWatchRef.current);
        speakWatchRef.current = null;
        audioRef.current = null;
        replyRef.current = "";
        setMode(micWantedRef.current ? "listening" : "idle");
      };
      // Watchdog: never stay stuck in "speaking" (browser voices sometimes never fire onend).
      speakWatchRef.current = window.setTimeout(done, Math.min(45000, 4000 + text.length * 90));

      // 1) Natural high-quality voice
      try {
        const r = await fetch("/api/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (token !== speakTokenRef.current) return;
        if (r.ok) {
          const url = URL.createObjectURL(await r.blob());
          if (token !== speakTokenRef.current) return URL.revokeObjectURL(url);
          const a = new Audio(url);
          const t = VOICE_TUNING[personaRef.current] ?? VOICE_TUNING["classic"]!;
          a.playbackRate = Math.min(1.25, Math.max(0.85, t.rate));
          a.onended = () => {
            URL.revokeObjectURL(url);
            done();
          };
          a.onerror = done;
          audioRef.current = a;
          await a.play();
          return;
        }
      } catch {
        /* fall back */
      }
      if (token !== speakTokenRef.current) return;
      // 2) Fallback: device voice
      const synth = window.speechSynthesis;
      if (!synth) return done();
      const u = new SpeechSynthesisUtterance(text);
      const t = VOICE_TUNING[personaRef.current] ?? VOICE_TUNING["classic"]!;
      u.rate = t.rate;
      u.pitch = t.pitch;
      u.onend = done;
      u.onerror = done;
      synth.speak(u);
    },
    [haltAudio],
  );

  // ---------- ask ----------
  const ensureConversation = useCallback(async () => {
    if (convRef.current) return convRef.current;
    const row = await newConv({ data: {} });
    convRef.current = row.id;
    qc.setQueryData(["messages", row.id], []);
    void navigate({ to: "/melo", search: { c: row.id }, replace: true });
    return row.id;
  }, [newConv, navigate, qc]);

  const send = useCallback(
    async (opts: { userText?: string; source: "text" | "voice" | "screen"; auto?: boolean; kind?: "first" | "stuck" }) => {
      if (busyRef.current) {
        // Never drop what the person says — run it right after the current request.
        if (!opts.auto) pendingRef.current = opts;
        return;
      }
      busyRef.current = true;
      setError(null);
      haltAudio();
      setMode("thinking");
      const userText = opts.userText?.trim();
      if (userText) setTurns((p) => [...p, { id: crypto.randomUUID(), role: "user", content: userText }]);
      try {
        const id = await ensureConversation();
        const image = streamRef.current ? grabFrame() : undefined;
        if (opts.auto && !image) return;
        if (image) setStats((s) => ({ ...s, sent: s.sent + 1 }));
        const prompt = opts.auto
          ? opts.kind === "first"
            ? "I just started sharing my screen. Briefly say what you see and ask what I want to do, or if my goal is already clear, give the first step. Never reply SKIP."
            : opts.kind === "stuck"
              ? "My screen hasn't changed for a while — I might be stuck. If there's a clear next step toward my goal, tell me exactly what to click. If there's nothing useful to add, reply exactly SKIP."
              : "My screen just changed. If I'm on track give the next single step; if I clicked something wrong say so; if nothing needs a reaction reply exactly SKIP."
          : image
            ? `Here is my screen right now. I said: "${userText}". Answer directly using what you see — never reply SKIP.`
            : userText;
        const res = await Promise.race([
          ask({
            data: {
              text: prompt,
              ...(image ? { image } : {}),
              conversationId: id,
              source: opts.source,
              userText: opts.auto ? "(screen check)" : userText,
              personality: personaRef.current,
              history: turnsRef.current.slice(-10).map(({ role, content }) => ({ role, content: content.slice(0, 4000) })),
            },
          }),
          new Promise<never>((_, rej) => window.setTimeout(() => rej(new Error("Melo took too long — try again.")), 30000)),
        ]);
        if (!res.ok) {
          setError(
            res.reason === "trial_expired"
              ? "Your free trial has ended."
              : res.reason === "limit_reached"
                ? "You've hit today's usage limit. It resets at midnight UTC."
                : res.reason === "rate_limited"
                  ? "Too many requests — give it a few seconds."
                  : "Couldn't reach Melo. Try again.",
          );
          setMode(micWantedRef.current ? "listening" : "idle");
          return;
        }
        const reply = res.reply.trim();
        const silent = reply.toUpperCase().startsWith("SKIP");
        if (!silent) {
          setTurns((p) => [...p, { id: crypto.randomUUID(), role: "assistant", content: reply }]);
          speak(reply);
        } else setMode(micWantedRef.current ? "listening" : "idle");
        void qc.invalidateQueries({ queryKey: ["workspace"] });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
        setMode(micWantedRef.current ? "listening" : "idle");
      } finally {
        busyRef.current = false;
        const next = pendingRef.current;
        pendingRef.current = null;
        if (next) void sendRef.current(next);
      }
    },
    [ask, ensureConversation, grabFrame, speak, haltAudio, qc],
  );
  const sendRef = useRef(send);
  sendRef.current = send;

  // local screen awareness: thumbnail every 2s; AI on first look, big change, or when stuck
  useEffect(() => {
    if (!sharing) return;
    let firstDone = false;
    let lastChangeAt = Date.now();
    let stuckNudged = false;
    const t = window.setInterval(() => {
      const v = videoRef.current;
      if (!v || !v.videoWidth) return;
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 36;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(v, 0, 0, 64, 36);
      const px = ctx.getImageData(0, 0, 64, 36).data;
      setStats((s) => ({ ...s, captured: s.captured + 1 }));
      const last = lastThumbRef.current;
      lastThumbRef.current = px;
      const now = Date.now();
      const free = modeRef.current !== "speaking" && !busyRef.current && !interimRef.current;
      if (!firstDone) {
        if (!free) return;
        firstDone = true;
        lastAutoRef.current = now;
        void sendRef.current({ source: "screen", auto: true, kind: "first" });
        return;
      }
      if (!last) return;
      let diff = 0;
      for (let i = 0; i < px.length; i += 4) diff += Math.abs(px[i]! - last[i]!);
      const mean = diff / (px.length / 4);
      if (mean > 1.5) {
        lastChangeAt = now;
        stuckNudged = false;
      }
      if (!free) return;
      if (mean > MEANINGFUL_CHANGE && now - lastAutoRef.current > AUTO_CHECK_MIN_GAP_MS) {
        lastAutoRef.current = now;
        void sendRef.current({ source: "screen", auto: true });
      } else if (!stuckNudged && now - lastChangeAt > STUCK_AFTER_MS && now - lastAutoRef.current > STUCK_AFTER_MS) {
        stuckNudged = true;
        lastAutoRef.current = now;
        void sendRef.current({ source: "screen", auto: true, kind: "stuck" });
      }
    }, 2000);
    return () => window.clearInterval(t);
  }, [sharing]);

  // ---------- hands-free mic ----------
  const stopMic = useCallback(() => {
    micWantedRef.current = false;
    recRef.current?.stop();
    recRef.current = null;
    setMicOn(false);
    setInterim("");
    if (modeRef.current === "listening") setMode("idle");
  }, []);

  const startMic = useCallback(async () => {
    setError(null);
    const W = window as unknown as { SpeechRecognition?: SR; webkitSpeechRecognition?: SR };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) {
      setError("Hands-free voice needs Chrome or Edge on a computer. You can still type.");
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      setError("I need microphone access. Allow it and try again.");
      return;
    }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (e: SR) => {
      let partial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text: string = r[0].transcript.trim();
        if (r.isFinal) {
          setInterim("");
          if (!text || FILLER.test(text)) continue;
          // ignore Melo hearing itself
          if (replyRef.current && replyRef.current.includes(text.toLowerCase())) continue;
          window.speechSynthesis?.cancel();
          replyRef.current = "";
          void sendRef.current({ userText: text, source: "voice" });
        } else partial += text;
      }
      if (partial) {
        setInterim(partial);
        // barge-in: user talking over Melo
        if (modeRef.current === "speaking" && partial.split(" ").length >= 2 && !replyRef.current.includes(partial.toLowerCase())) {
          window.speechSynthesis?.cancel();
          replyRef.current = "";
          setMode("listening");
        }
      }
    };
    rec.onerror = (e: SR) => {
      if (e.error === "not-allowed") {
        setError("Microphone blocked. Allow it in your browser.");
        stopMic();
      }
    };
    rec.onend = () => {
      if (micWantedRef.current) {
        try {
          rec.start();
        } catch {
          /* already running */
        }
      }
    };
    recRef.current = rec;
    micWantedRef.current = true;
    rec.start();
    setMicOn(true);
    if (modeRef.current === "idle") setMode("listening");
  }, [stopMic]);

  useEffect(
    () => () => {
      micWantedRef.current = false;
      recRef.current?.stop();
      window.speechSynthesis?.cancel();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  // reset per conversation switch
  useEffect(() => {
    window.speechSynthesis?.cancel();
    textareaRef.current?.focus();
  }, [convId]);

  const submitText = () => {
    const t = input.trim();
    if (!t) return;
    setInput("");
    void send({ userText: t, source: "text" });
    textareaRef.current?.focus();
  };

  // ---------- sidebar data ----------
  const projects = (ws.data?.projects ?? []).filter((p) => !p.archived);
  const convs = useMemo(
    () => (ws.data?.conversations ?? []).filter((c) => !c.archived && c.title.toLowerCase().includes(search.toLowerCase())),
    [ws.data, search],
  );
  const refresh = () => void qc.invalidateQueries({ queryKey: ["workspace"] });

  const goNew = () => {
    window.speechSynthesis?.cancel();
    void navigate({ to: "/melo", search: {} });
  };

  const convMenu = (c: { id: string; title: string; favorite: boolean; project_id: string | null }) => (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded p-1 opacity-0 hover:bg-accent group-hover:opacity-100 data-[state=open]:opacity-100" aria-label="Chat options">
        <MoreHorizontal className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={async () => {
            const t = prompt("Rename chat", c.title);
            if (t?.trim()) {
              await patchConv({ data: { id: c.id, title: t.trim() } });
              refresh();
            }
          }}
        >
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onClick={async () => (await patchConv({ data: { id: c.id, favorite: !c.favorite } }), refresh())}>
          {c.favorite ? "Remove from favorites" : "Add to favorites"}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Move to project</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={async () => (await patchConv({ data: { id: c.id, projectId: null } }), refresh())}>No project</DropdownMenuItem>
            {projects.map((p) => (
              <DropdownMenuItem key={p.id} onClick={async () => (await patchConv({ data: { id: c.id, projectId: p.id } }), refresh())}>
                {p.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onClick={async () => (await patchConv({ data: { id: c.id, archived: true } }), refresh(), c.id === convId && goNew())}>
          Archive
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive"
          onClick={async () => {
            if (!confirm("Delete this chat permanently?")) return;
            await delConv({ data: { id: c.id } });
            refresh();
            if (c.id === convId) goNew();
          }}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const convRow = (c: (typeof convs)[number], indent = false) => (
    <div
      key={c.id}
      className={cn(
        "group flex items-center gap-1 rounded-lg pr-1 text-sm",
        indent && "ml-4",
        c.id === convId ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <Link to="/melo" search={{ c: c.id }} className="min-w-0 flex-1 truncate px-2.5 py-1.5">
        {c.title}
      </Link>
      {convMenu(c)}
    </div>
  );

  const statusLabel =
    mode === "listening" ? "Listening" : mode === "thinking" ? "Thinking" : mode === "speaking" ? "Melo speaking" : micOn ? "Mic on" : "Talk";

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <video ref={videoRef} muted playsInline className="hidden" />

      {/* LEFT SIDEBAR */}
      <aside className={cn("flex w-72 shrink-0 flex-col border-r border-border bg-card/40 transition-all", !sidebarOpen && "-ml-72", "max-md:absolute max-md:inset-y-0 max-md:z-30 max-md:bg-background")}>
        <div className="flex items-center justify-between px-4 py-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="orb-stage grid size-7 place-items-center" data-mode="idle">
              <span className="orb-swirl orb-swirl-1" />
              <span className="orb-glass" />
            </span>
            <span className="font-display text-base tracking-tight">Melo</span>
          </Link>
          <button onClick={() => setSidebarOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-accent" aria-label="Hide sidebar">
            <PanelLeft className="size-4" />
          </button>
        </div>
        <div className="space-y-2 px-3">
          <button onClick={goNew} className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent">
            <Plus className="size-4" /> New chat
          </button>
          <label className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <Search className="size-4 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search chats" className="w-full bg-transparent placeholder:text-muted-foreground focus:outline-none" />
          </label>
        </div>

        <nav className="mt-4 flex-1 space-y-5 overflow-y-auto px-3 pb-4">
          {convs.some((c) => c.favorite) && (
            <section>
              <h3 className="mb-1 flex items-center gap-1.5 px-2.5 text-xs font-medium text-muted-foreground"><Star className="size-3" /> Favorites</h3>
              {convs.filter((c) => c.favorite).map((c) => convRow(c))}
            </section>
          )}

          <section>
            <div className="mb-1 flex items-center justify-between px-2.5">
              <h3 className="text-xs font-medium text-muted-foreground">Projects</h3>
              <button
                aria-label="New project"
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={async () => {
                  const n = prompt("Project name");
                  if (n?.trim()) {
                    await putProject({ data: { name: n.trim() } });
                    refresh();
                  }
                }}
              >
                <FolderPlus className="size-3.5" />
              </button>
            </div>
            {projects.length === 0 && <p className="px-2.5 text-xs text-muted-foreground/70">Group chats into projects.</p>}
            {projects.map((p) => (
              <div key={p.id}>
                <div className="group flex items-center gap-1 rounded-lg pr-1 text-sm hover:bg-accent/60">
                  <span className="flex min-w-0 flex-1 items-center gap-2 truncate px-2.5 py-1.5">
                    {p.pinned ? <Pin className="size-3.5 shrink-0" /> : <Folder className="size-3.5 shrink-0" />}
                    <span className="truncate">{p.name}</span>
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger className="rounded p-1 opacity-0 hover:bg-accent group-hover:opacity-100 data-[state=open]:opacity-100" aria-label="Project options">
                      <MoreHorizontal className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={async () => {
                          const r = await newConv({ data: { projectId: p.id } });
                          refresh();
                          void navigate({ to: "/melo", search: { c: r.id } });
                        }}
                      >
                        New chat in project
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={async () => {
                          const n = prompt("Rename project", p.name);
                          if (n?.trim()) (await putProject({ data: { id: p.id, name: n.trim() } }), refresh());
                        }}
                      >
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={async () => (await putProject({ data: { id: p.id, pinned: !p.pinned } }), refresh())}>
                        {p.pinned ? "Unpin" : "Pin"}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={async () => (await putProject({ data: { id: p.id, archived: true } }), refresh())}>Archive</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={async () => {
                          if (confirm("Delete this project? Its chats are kept.")) (await delProject({ data: { id: p.id } }), refresh());
                        }}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {convs.filter((c) => c.project_id === p.id).map((c) => convRow(c, true))}
              </div>
            ))}
          </section>

          <section>
            <h3 className="mb-1 px-2.5 text-xs font-medium text-muted-foreground">Recent</h3>
            {ws.isLoading && <p className="px-2.5 text-xs text-muted-foreground">Loading…</p>}
            {!ws.isLoading && convs.filter((c) => !c.project_id).length === 0 && (
              <p className="px-2.5 text-xs text-muted-foreground/70">Your chats will appear here.</p>
            )}
            {convs.filter((c) => !c.project_id).map((c) => convRow(c))}
          </section>
        </nav>

        <div className="border-t border-border p-3">
          <Link to="/dashboard" className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
            <Settings className="size-4" /> Settings & plan
          </Link>
        </div>
      </aside>

      {/* MAIN */}
      <main className="relative flex min-w-0 flex-1 flex-col">
        {!sidebarOpen && (
          <button onClick={() => setSidebarOpen(true)} className="absolute left-3 top-3 z-10 rounded-lg p-2 text-muted-foreground hover:bg-accent" aria-label="Show sidebar">
            <PanelLeft className="size-4" />
          </button>
        )}
        {sharing && !panelOpen && (
          <button onClick={() => setPanelOpen(true)} className="absolute right-3 top-3 z-10 flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs" aria-label="Show session panel">
            <span className="size-2 rounded-full bg-primary animate-pulse" /> Screen connected <PanelRightOpen className="size-3.5" />
          </button>
        )}

        <div className="flex-1 overflow-y-auto">
          {turns.length === 0 && !msgs.isLoading ? (
            <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center px-6 text-center">
              <span className="orb-stage grid size-24 place-items-center" data-mode={mode}>
                <span className="orb-rim" />
                <span className="orb-swirl orb-swirl-1" />
                <span className="orb-swirl orb-swirl-2" />
                <span className="orb-glass" />
              </span>
              <h1 className="mt-6 font-display text-4xl tracking-tight">Melo</h1>
              <p className="mt-2 text-muted-foreground">Your AI assistant that sees what you see.</p>
              <div className="mt-8 flex flex-wrap justify-center gap-2">
                <button
                  onClick={async () => {
                    if (!sharing) await startSharing();
                    if (!micOn) await startMic();
                  }}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  <MonitorUp className="size-4" /> Share screen & talk
                </button>
                <button onClick={() => (micOn ? stopMic() : void startMic())} className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm hover:bg-accent">
                  <Mic className="size-4" /> Talk to Melo
                </button>
                <button onClick={() => textareaRef.current?.focus()} className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm hover:bg-accent">
                  Start a chat
                </button>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-2xl space-y-6 px-6 py-10" aria-live="polite">
              {turns.map((t) => (
                <div key={t.id} className={t.role === "user" ? "flex justify-end" : "flex gap-3"}>
                  {t.role === "assistant" && (
                    <span className="orb-stage mt-0.5 grid size-6 shrink-0 place-items-center" data-mode="idle">
                      <span className="orb-swirl orb-swirl-1" />
                      <span className="orb-glass" />
                    </span>
                  )}
                  <p className={t.role === "user" ? "max-w-[80%] rounded-2xl bg-secondary px-4 py-2.5 text-sm text-secondary-foreground" : "max-w-[85%] leading-relaxed"}>
                    {t.content}
                  </p>
                </div>
              ))}
              {mode === "thinking" && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Melo is thinking…
                </div>
              )}
            </div>
          )}
        </div>

        {/* COMPOSER */}
        <div className="mx-auto w-full max-w-2xl px-4 pb-5">
          {error && <p className="mb-2 text-center text-sm text-destructive">{error}</p>}
          {interim && <p className="mb-2 truncate text-center text-sm italic text-muted-foreground">“{interim}”</p>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitText();
            }}
            className="rounded-2xl border border-border bg-card p-2 shadow-lg"
          >
            <textarea
              ref={textareaRef}
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitText();
                }
              }}
              rows={2}
              placeholder={sharing ? "Ask about what's on your screen…" : "Ask Melo anything…"}
              className="w-full resize-none bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none"
            />
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => (sharing ? stopSharing() : void startSharing())}
                  className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs", sharing ? "bg-primary/15 text-primary" : "hover:bg-accent text-muted-foreground")}
                >
                  {sharing ? <MonitorX className="size-4" /> : <MonitorUp className="size-4" />}
                  {sharing ? "Stop sharing" : "Share screen"}
                </button>
                <button
                  type="button"
                  onClick={() => (mode === "speaking" ? stopSpeaking() : micOn ? stopMic() : void startMic())}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs",
                    micOn ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground",
                  )}
                  aria-label={mode === "speaking" ? "Stop Melo speaking" : micOn ? "Mute microphone" : "Talk to Melo"}
                >
                  {mode === "thinking" ? <Loader2 className="size-4 animate-spin" /> : mode === "speaking" ? <Volume2 className="size-4" /> : micOn ? <Mic className="size-4" /> : <MicOff className="size-4" />}
                  {statusLabel}
                </button>
              </div>
              <button type="submit" disabled={!input.trim() || mode === "thinking"} aria-label="Send" className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40">
                <ArrowUp className="size-4" />
              </button>
            </div>
          </form>
        </div>
      </main>

      {/* RIGHT PANEL */}
      {sharing && panelOpen && (
        <aside className="hidden w-64 shrink-0 flex-col gap-4 border-l border-border bg-card/40 p-4 lg:flex">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Live session</h2>
            <button onClick={() => setPanelOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-accent" aria-label="Hide panel">
              <PanelRightClose className="size-4" />
            </button>
          </div>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2"><span className="size-2 rounded-full bg-primary animate-pulse" /> Screen connected</li>
            <li className="flex items-center gap-2"><span className={cn("size-2 rounded-full", micOn ? "bg-primary" : "bg-muted-foreground/40")} /> {micOn ? "Mic active" : "Mic muted"}</li>
            <li className="flex items-center gap-2"><span className={cn("size-2 rounded-full", mode === "speaking" ? "bg-primary animate-pulse" : "bg-muted-foreground/40")} /> {statusLabel}</li>
          </ul>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Personality</label>
            <select
              value={personality}
              onChange={(e) => {
                setPersonality(e.target.value);
                localStorage.setItem("melo-personality", e.target.value);
              }}
              className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
            >
              {PERSONALITIES.map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {p.desc}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">
            Frames seen: {stats.captured} · sent to Melo: {stats.sent}
          </p>
          <button
            onClick={() => {
              stopMic();
              stopSpeaking();
              stopSharing();
            }}
            className="mt-auto rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
          >
            Stop session
          </button>
        </aside>
      )}
    </div>
  );
}
