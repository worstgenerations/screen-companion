import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Users, Zap, Coins, Activity } from "lucide-react";

import { getAdminStats } from "@/lib/melo.functions";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [{ title: "Admin — Melo AI" }],
  }),
  component: AdminPage,
});

function AdminPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => getAdminStats(),
    retry: false,
  });

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-aura-field" aria-hidden="true" />

      <div className="relative mx-auto max-w-3xl px-6 py-10">
        <header className="flex items-center justify-between">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Dashboard
          </Link>
          <h1 className="font-display text-lg tracking-tight">Admin</h1>
        </header>

        {isLoading && (
          <div className="mt-20 grid place-items-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <p className="mt-20 text-center text-sm text-destructive">
            You don't have access to this page.
          </p>
        )}

        {data && (
          <>
            <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard icon={<Users className="size-4" />} label="Total users" value={String(data.totalUsers)} />
              <StatCard
                icon={<Activity className="size-4" />}
                label="Active today"
                value={String(data.today.activeUsers)}
              />
              <StatCard
                icon={<Zap className="size-4" />}
                label="Interactions today"
                value={String(data.today.interactions)}
              />
              <StatCard
                icon={<Coins className="size-4" />}
                label="Tokens today"
                value={`${((data.today.inputTokens + data.today.outputTokens) / 1000).toFixed(1)}k`}
              />
            </section>

            <section className="mt-6 rounded-2xl border border-border bg-card/80 p-5 backdrop-blur">
              <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Accounts by status
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(["TRIALING", "ACTIVE", "EXPIRED", "CANCELLED"] as const).map((s) => (
                  <div key={s} className="rounded-xl bg-muted/50 p-3 text-center">
                    <p className="font-display text-xl">{data.byStatus[s] ?? 0}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{s.toLowerCase()}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-6 rounded-2xl border border-border bg-card/80 p-5 backdrop-blur">
              <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Recent signups
              </h2>
              <ul className="mt-3 divide-y divide-border">
                {data.recentSignups.length === 0 && (
                  <li className="py-3 text-sm text-muted-foreground">No signups yet.</li>
                )}
                {data.recentSignups.map((s) => (
                  <li key={s.email} className="flex items-center justify-between py-2.5 text-sm">
                    <span>{s.email}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(s.createdAt).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/80 p-4 backdrop-blur">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </p>
      <p className="mt-2 font-display text-2xl">{value}</p>
    </div>
  );
}
