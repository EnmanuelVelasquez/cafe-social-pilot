import { Link } from "@tanstack/react-router";
import { LayoutDashboard, Sparkles, Images, Zap } from "lucide-react";
import type { ReactNode } from "react";

const nav = [
  { to: "/", label: "Contenido", icon: LayoutDashboard },
  { to: "/marca", label: "Brand Engine", icon: Sparkles },
  { to: "/activos", label: "Activos", icon: Images },
] as const;

export function AppShell({ title, subtitle, action, children }: { title: string; subtitle: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0 md:pl-64">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r bg-card p-5 md:flex">
        <Brand />
        <nav className="mt-8 space-y-1">
          {nav.map((n) => (
            <Link key={n.to} to={n.to} activeOptions={{ exact: true }} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground" activeProps={{ className: "bg-primary-soft !text-primary" }}>
              <n.icon className="h-4 w-4" /> {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-3 rounded-xl border p-3">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-brand text-sm font-bold text-primary-foreground">CJ</div>
          <div className="min-w-0"><p className="truncate text-sm font-semibold">Café Don Juan</p><p className="text-xs text-muted-foreground">Plan Agencia</p></div>
        </div>
      </aside>
      <header className="sticky top-0 z-20 flex items-center border-b bg-card/90 px-4 py-3 backdrop-blur md:hidden"><Brand /></header>
      <main className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10">
        <div className="mb-6 grid gap-4 sm:flex sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          </div>
          {action}
        </div>
        {children}
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t bg-card md:hidden">
        {nav.map((n) => (
          <Link key={n.to} to={n.to} activeOptions={{ exact: true }} className="flex flex-col items-center gap-1 py-2.5 text-xs text-muted-foreground" activeProps={{ className: "!text-primary" }}>
            <n.icon className="h-5 w-5" />{n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand shadow-glow"><Zap className="h-5 w-5 text-primary-foreground" /></div>
      <span className="font-display text-lg font-bold">AutoSocial <span className="text-brand">AI</span></span>
    </div>
  );
}
