import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Melo AI" },
      { name: "description", content: "Sign in or create your Melo AI account to start your 7-day free trial." },
      { property: "og:title", content: "Sign in — Melo AI" },
      { property: "og:description", content: "Sign in or create your Melo AI account to start your 7-day free trial." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signup") {
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (err) throw err;
        if (!data.session) {
          setNotice("Check your email to confirm your account, then sign in.");
          setMode("signin");
          return;
        }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      }
      void navigate({ to: "/dashboard" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-aura-field" aria-hidden="true" />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center">
          <Link to="/" className="inline-block">
            <span className="orb-stage mx-auto grid size-16 place-items-center" data-mode="idle">
              <span className="orb-rim" />
              <span className="orb-swirl orb-swirl-1" />
              <span className="orb-swirl orb-swirl-2" />
              <span className="orb-glass" />
            </span>
          </Link>
          <h1 className="mt-5 font-display text-2xl tracking-tight">
            {mode === "signup" ? "Start your free trial" : "Welcome back"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "signup"
              ? "7 days of Melo AI, free. Cancel anytime."
              : "Sign in to continue to your dashboard."}
          </p>
        </div>

        <form
          onSubmit={(e) => void submit(e)}
          className="space-y-3 rounded-2xl border border-border bg-card/80 p-6 backdrop-blur"
        >
          {mode === "signup" && (
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
              className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          )}
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (6+ characters)"
            className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />

          {error && <p className="text-sm text-destructive">{error}</p>}
          {notice && <p className="text-sm text-emerald-400">{notice}</p>}

          <button
            type="submit"
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {mode === "signup" ? "Create account" : "Sign in"}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode(mode === "signup" ? "signin" : "signup");
              setError(null);
              setNotice(null);
            }}
            className="w-full pt-1 text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            {mode === "signup" ? "Already have an account? Sign in" : "New here? Start your free trial"}
          </button>
        </form>
      </div>
    </main>
  );
}
