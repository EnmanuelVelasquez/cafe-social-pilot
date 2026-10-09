import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CalendarClock, CheckCircle2, ImageIcon, Instagram, Facebook, Clock, Bot, ShieldCheck, Pencil } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { posts as initial, assets } from "@/lib/data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard de Contenido — AutoSocial AI" },
      { name: "description", content: "Aprueba y programa publicaciones generadas por IA para Instagram y Facebook." },
      { property: "og:title", content: "Dashboard de Contenido — AutoSocial AI" },
      { property: "og:description", content: "Aprueba y programa publicaciones generadas por IA para Instagram y Facebook." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const [posts, setPosts] = useState(initial);
  const [auto, setAuto] = useState(false);
  const [editing, setEditing] = useState<{ id: number; draft: string } | null>(null);
  const scheduled = posts.filter((p) => p.status === "programado").length;

  const approve = (id: number) => {
    setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, status: "programado" } : p)));
    toast.success("Publicación aprobada y programada");
  };
  const toggle = (v: boolean) => {
    setAuto(v);
    if (v) setPosts((ps) => ps.map((p) => ({ ...p, status: "programado" })));
    toast(v ? "Modo Autónomo activado" : "Modo Supervisado activado");
  };
  const openEdit = (id: number) => {
    const post = posts.find((p) => p.id === id);
    if (post) setEditing({ id, draft: post.copy });
  };
  const saveCopy = () => {
    if (!editing) return;
    const text = editing.draft.trim();
    if (!text) {
      toast.error("El texto no puede quedar vacío");
      return;
    }
    setPosts((ps) => ps.map((p) => (p.id === editing.id ? { ...p, copy: text } : p)));
    setEditing(null);
    toast.success("Texto actualizado");
  };

  const stats = [
    { label: "Posts Programados", value: scheduled, icon: CalendarClock, tone: "bg-primary-soft text-primary" },
    { label: "Publicados este mes", value: 24, icon: CheckCircle2, tone: "bg-success-soft text-success" },
    { label: "Activos Disponibles en Galería", value: assets.length, icon: ImageIcon, tone: "bg-violet-soft text-violet" },
  ];

  return (
    <AppShell title="Dashboard de Contenido" subtitle="Café Don Juan · Próximas publicaciones generadas por IA">
      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="flex items-center gap-4 rounded-2xl border bg-card p-5 shadow-card">
            <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${s.tone}`}><s.icon className="h-6 w-6" /></div>
            <div className="min-w-0"><p className="font-display text-2xl font-bold">{s.value}</p><p className="text-sm text-muted-foreground">{s.label}</p></div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand text-primary-foreground">{auto ? <Bot className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}</div>
          <div>
            <p className="font-semibold">{auto ? "Modo Autónomo" : "Modo Supervisado (Aprobación Manual)"}</p>
            <p className="text-sm text-muted-foreground">{auto ? "La IA publica automáticamente sin revisión." : "Revisas y apruebas cada post antes de publicarse."}</p>
          </div>
        </div>
        <label className="flex items-center gap-3 text-sm font-medium">
          <span className={auto ? "text-muted-foreground" : "text-primary"}>Supervisado</span>
          <Switch checked={auto} onCheckedChange={toggle} />
          <span className={auto ? "text-violet" : "text-muted-foreground"}>Autónomo</span>
        </label>
      </div>

      <h2 className="mb-3 mt-8 font-display text-lg font-semibold">Próximas publicaciones</h2>
      <div className="space-y-3">
        {posts.map((p) => (
          <article key={p.id} className="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-card sm:flex-row">
            <img src={p.img} alt={p.pillar} loading="lazy" width={816} height={816} className="aspect-square w-full rounded-xl object-cover sm:w-28" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
                  {p.network === "Instagram" ? <Instagram className="h-3.5 w-3.5 text-violet" /> : <Facebook className="h-3.5 w-3.5 text-primary" />}{p.network}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1"><Clock className="h-3.5 w-3.5" />{p.when}</span>
                <span className="rounded-full bg-violet-soft px-2.5 py-1 text-violet">{p.pillar}</span>
                <span className={`rounded-full px-2.5 py-1 ${p.status === "pendiente" ? "bg-warning-soft text-warning" : "bg-success-soft text-success"}`}>
                  {p.status === "pendiente" ? "Pendiente de Aprobación" : "Programado"}
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed">{p.copy}</p>
            </div>
            {p.status === "pendiente" && (
              <Button variant="brand" className="shrink-0 self-start sm:self-center" onClick={() => approve(p.id)}>
                <CheckCircle2 /> Aprobar y Programar
              </Button>
            )}
          </article>
        ))}
      </div>
    </AppShell>
  );
}
