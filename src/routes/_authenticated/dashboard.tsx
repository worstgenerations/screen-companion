import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MonitorPlay, ShieldCheck, LogOut, Loader2, Clock, Zap } from "lucide-react";

import { getAccountState } from "@/lib/melo.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Melo AI" },
      { name: "description", content: "Your Melo AI account, trial status and daily usage." },
    ],
  }),
  component: Dashboard,
});

function statusLabel(status: string) {
  switch (status) {
    case "TRIALING":
      return "Free trial";
    case "ACTIVE":
      return "Pro";
    case "EXPIRED":
      return "Trial ended";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}

function Dashboard() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ["account-state"],
    queryFn: () => getAccountState(),
  });

  const signOut = async () => {
    await supabase.auth.signOut();
    void navigate({ to: "/" });
  };

  if (isLoading) {
    return (
      <main className="grid min-h-screen place-items-center bg-background text-foreground">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-6 text-foreground">
        <p className="text-sm text-destructive">Couldn't load your account. Refresh to try again.</p>
      </main>
    );
  }

  const usagePct = Math.min(100, (data.usageToday.interactions / data.usageToday.dailyLimit) * 100);
  const trialPct =
    data.status === "TRIALING" ? Math.max(0, (data.trialDaysLeft / data.trialDays) * 100) : 0;

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-aura-field" aria-hidden="true" />

      <div className="relative mx-auto max-w-2xl px-6 py-10">
        <header className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <span className="orb-stage grid size-10 place-items-center" data-mode="idle">
              <span className="orb-rim" />
              <span className="orb-swirl orb-swirl-1" />
              <span className="orb-glass" />
            </span>
            <span className="font-display text-lg tracking-tight">Melo AI</span>
          </Link>
          <div className="flex items-center gap-2">
            {data.isAdmin && (
              <Link
                to="/admin"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <ShieldCheck className="size-3.5" /> Admin
              </Link>
            )}
            <button
              onClick={() => void signOut()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <LogOut className="size-3.5" /> Sign out
            </button>
          </div>
        </header>

        <section className="mt-10">
          <h1 className="font-display text-3xl tracking-tight">
            Hey{data.fullName ? `, ${data.fullName.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{data.email}</p>
        </section>

        <section className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card/80 p-5 backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Plan</p>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  data.entitled
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-destructive/15 text-destructive"
                }`}
              >
                {statusLabel(data.status)}
              </span>
            </div>
            <p className="mt-3 font-display text-2xl">
              ${(data.priceCents / 100).toFixed(0)}
              <span className="text-sm text-muted-foreground">/month</span>
            </p>
            {data.status === "TRIALING" && (
              <div className="mt-3">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="size-3.5" />
                  {data.trialDaysLeft} day{data.trialDaysLeft === 1 ? "" : "s"} left in your trial
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${trialPct}%` }} />
                </div>
              </div>
            )}
            {data.status === "EXPIRED" && (
              <p className="mt-3 text-xs text-muted-foreground">
                Your trial has ended. Billing opens soon — you'll be able to continue with Pro.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card/80 p-5 backdrop-blur">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Zap className="size-3.5" /> Usage today
            </p>
            <p className="mt-3 font-display text-2xl">
              {data.usageToday.interactions}
              <span className="text-sm text-muted-foreground"> / {data.usageToday.dailyLimit} interactions</span>
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${usagePct}%` }} />
            </div>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-border bg-card/80 p-6 text-center backdrop-blur">
          {data.entitled ? (
            <>
              <p className="text-sm text-muted-foreground">
                Ready when you are. Melo will watch your screen and talk you through your task.
              </p>
              <Link
                to="/melo"
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                <MonitorPlay className="size-4" /> Start Melo
              </Link>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Your trial has ended. Paid plans open soon — check back shortly.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
