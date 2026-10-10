import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { CalendarClock, CheckCircle2, ImageIcon, Instagram, Facebook, Clock, Bot, ShieldCheck, Pencil } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase";

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

// Definimos un tipo rápido para que TypeScript no se queje
type PostData = {
  id: string;
  copy: string;
  when: string;
  network: string;
  status: string;
  img: string;
  pillar: string;
};

function Dashboard() {
  const [posts, setPosts] = useState<PostData[]>([]);
  const [auto, setAuto] = useState(false);
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  
  // Cargar datos reales de Supabase
  useEffect(() => {
    const fetchPosts = async () => {
      const { data, error } = await supabase
        .from('publicaciones')
        .select(`
          id, 
          texto_copy, 
          fecha_publicacion, 
          red_social, 
          estado, 
          activos (url_imagen, tags)
        `);

      if (data && !error) {
        const formattedPosts = data.map((d: any) => ({
          id: d.id,
          copy: d.texto_copy,
          // Formateamos la fecha a algo legible (puedes ajustarlo luego con date-fns si prefieres)
          when: new Date(d.fecha_publicacion).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }),
          network: d.red_social,
          status: d.estado,
          img: d.activos?.url_imagen || '',
          pillar: d.activos?.tags || 'General'
        }));
        setPosts(formattedPosts);
      } else if (error) {
        toast.error("Error cargando publicaciones");
        console.error(error);
      }
    };
    
    fetchPosts();
  }, []);

  const scheduled = posts.filter((p) => p.status === "programado").length;

  const approve = async (id: string) => {
    // Actualización optimista en la UI
    setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, status: "programado" } : p)));
    
    // Actualización real en la base de datos
    const { error } = await supabase
      .from('publicaciones')
      .update({ estado: 'programado' })
      .eq('id', id);
      
    if (error) {
      toast.error("Hubo un error al guardar en la base de datos");
      // Revertir estado si falla (opcional, pero buena práctica)
      setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, status: "pendiente" } : p)));
    } else {
      toast.success("Publicación aprobada y programada");
    }
  };

  const toggle = (v: boolean) => {
    setAuto(v);
    if (v) setPosts((ps) => ps.map((p) => ({ ...p, status: "programado" })));
    toast(v ? "Modo Autónomo activado" : "Modo Supervisado activado");
  };

  const openEdit = (id: string) => {
    const post = posts.find((p) => p.id === id);
    if (post) setEditing({ id, draft: post.copy });
  };

  const saveCopy = async () => {
    if (!editing) return;
    const text = editing.draft.trim();
    if (!text) {
      toast.error("El texto no puede quedar vacío");
      return;
    }
    
    // UI optimista
    setPosts((ps) => ps.map((p) => (p.id === editing.id ? { ...p, copy: text, status: "programado" } : p)));
    
    // DB real
    const { error } = await supabase
      .from('publicaciones')
      .update({ texto_copy: text, estado: 'programado' })
      .eq('id', editing.id);

    setEditing(null);
    
    if (error) toast.error("Error guardando el texto");
    else toast.success("Texto actualizado y programado");
  };

  const stats = [
    { label: "Posts Programados", value: scheduled, icon: CalendarClock, tone: "bg-primary-soft text-primary" },
    { label: "Publicados este mes", value: 24, icon: CheckCircle2, tone: "bg-success-soft text-success" },
    { label: "Activos Disponibles en Galería", value: 12, icon: ImageIcon, tone: "bg-violet-soft text-violet" }, // Mock temporal hasta conectar galería
  ];

  return (
    <AppShell title={<span className="text-blue-900">AutoSocial AI - Panel de Control Automático</span>} subtitle="Café Don Juan · Próximas publicaciones generadas por IA">
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
          <article key={p.id} className={`flex flex-col gap-4 rounded-2xl p-4 shadow-card sm:flex-row ${p.status === "pendiente" ? "border border-orange-200 bg-orange-50" : "border bg-card"}`}>
            <img src={p.img} alt={p.pillar} loading="lazy" width={816} height={816} className="aspect-square w-full rounded-xl object-cover sm:w-28" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
                  {p.network === "Instagram" ? <Instagram className="h-3.5 w-3.5 text-violet" /> : <Facebook className="h-3.5 w-3.5 text-primary" />}{p.network}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1"><Clock className="h-3.5 w-3.5" />{p.when}</span>
                <span className="rounded-full bg-violet-soft px-2.5 py-1 text-violet">{p.pillar}</span>
                <Badge
                  variant={p.status === "pendiente" ? "pending" : "scheduled"}
                  className="rounded-full px-2.5 py-1"
                >
                  {p.status === "pendiente" ? "Pendiente de Aprobación" : "Programado"}
                </Badge>
              </div>
              <p className="mt-3 text-sm leading-relaxed">{p.copy}</p>
            </div>
            {p.status === "pendiente" && (
              <div className="flex shrink-0 gap-2 self-start sm:self-center">
                <Button variant="brand" onClick={() => approve(p.id)}>
                  <CheckCircle2 /> Aprobar y Programar
                </Button>
                <Button variant="outline" onClick={() => openEdit(p.id)}>
                  <Pencil /> Editar Copy
                </Button>
              </div>
            )}
          </article>
        ))}
        {posts.length === 0 && (
          <p className="text-muted-foreground text-sm py-4">Cargando publicaciones o no hay publicaciones disponibles...</p>
        )}
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar Copy</DialogTitle>
            <DialogDescription>Ajusta el texto antes de programar la publicación.</DialogDescription>
          </DialogHeader>
          <Textarea
            value={editing?.draft ?? ""}
            onChange={(e) => setEditing((prev) => (prev ? { ...prev, draft: e.target.value } : prev))}
            rows={6}
            maxLength={2200}
            placeholder="Escribe el texto de la publicación…"
            autoFocus
          />
          <p className="text-right text-xs text-muted-foreground">{editing?.draft.length ?? 0}/2200</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button variant="brand" onClick={saveCopy}>
              <CheckCircle2 /> Guardar y Programar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}