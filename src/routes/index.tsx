import { createFileRoute, Link } from "@tanstack/react-router";
import { MonitorPlay, Mic, Sparkles, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Melo AI — Sees Your Screen, Talks You Through It" },
      {
        name: "description",
        content:
          "Melo AI watches your screen, hears your voice, and speaks live step-by-step guidance for anything you're trying to do. Start your 7-day free trial.",
      },
      { property: "og:title", content: "Melo AI — Sees Your Screen, Talks You Through It" },
      {
        property: "og:description",
        content:
          "Melo AI watches your screen, hears your voice, and speaks live step-by-step guidance for anything you're trying to do. Start your 7-day free trial.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-aura-field" aria-hidden="true" />
      <div className="aura-ambient" data-mode="idle" aria-hidden="true" />

      <div className="relative mx-auto max-w-4xl px-6">
        <nav className="flex items-center justify-between py-6">
          <span className="flex items-center gap-3">
            <span className="orb-stage grid size-9 place-items-center" data-mode="idle">
              <span className="orb-rim" />
              <span className="orb-swirl orb-swirl-1" />
              <span className="orb-glass" />
            </span>
            <span className="font-display text-lg tracking-tight">Melo AI</span>
          </span>
          <Link
            to="/auth"
            className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </Link>
        </nav>

        <section className="flex flex-col items-center pb-24 pt-16 text-center sm:pt-24">
          <div className="orb-stage grid size-40 place-items-center sm:size-48" data-mode="idle">
            <span className="orb-rim" />
            <span className="orb-swirl orb-swirl-1" />
            <span className="orb-swirl orb-swirl-2" />
            <span className="orb-swirl orb-swirl-3" />
            <span className="orb-glass" />
          </div>

          <h1 className="mt-10 max-w-2xl text-balance font-display text-4xl leading-tight tracking-tight sm:text-6xl">
            Sees your screen.
            <br />
            Talks you through it.
          </h1>
          <p className="mt-5 max-w-xl text-balance text-base text-muted-foreground sm:text-lg">
            Melo watches what you're doing, hears your voice, and speaks live step-by-step
            guidance — for anything you're trying to get done on your computer.
          </p>

          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
            <Link
              to="/auth"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-7 py-3.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Start your 7-day free trial <ArrowRight className="size-4" />
            </Link>
            <p className="text-xs text-muted-foreground">Then $9/month. Cancel anytime.</p>
          </div>
        </section>

        <section className="grid gap-4 pb-24 sm:grid-cols-3">
          <Feature
            icon={<MonitorPlay className="size-5" />}
            title="Watches your screen"
            body="Share your screen once and Melo sees exactly what you see — every app, every button, every step."
          />
          <Feature
            icon={<Mic className="size-5" />}
            title="Hears your voice"
            body="Just talk. Ask a question or say your goal, and Melo answers out loud while you keep working."
          />
          <Feature
            icon={<Sparkles className="size-5" />}
            title="Guides step by step"
            body="One clear step at a time, spoken aloud — and if you're about to click the wrong thing, Melo stops you."
          />
        </section>

        <section className="pb-24">
          <div className="rounded-3xl border border-border bg-card/80 p-8 text-center backdrop-blur sm:p-12">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Simple pricing
            </p>
            <p className="mt-4 font-display text-5xl tracking-tight">
              $9<span className="text-lg text-muted-foreground">/month</span>
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              7 days free. Full access during your trial. Cancel anytime.
            </p>
            <Link
              to="/auth"
              className="mt-7 inline-flex items-center gap-2 rounded-xl bg-primary px-7 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Try Melo free <ArrowRight className="size-4" />
            </Link>
          </div>
        </section>

        <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
          Melo AI — your screen guide. Works on any desktop browser.
        </footer>
      </div>
    </main>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/60 p-6 backdrop-blur">
      <div className="grid size-10 place-items-center rounded-xl bg-primary/15 text-primary">{icon}</div>
      <h3 className="mt-4 font-display text-lg tracking-tight">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}
