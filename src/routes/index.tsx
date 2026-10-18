import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { CalendarClock, CheckCircle2, ImageIcon, Instagram, Facebook, Clock, Bot, ShieldCheck, Pencil, Download, Copy, Store } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useBranchStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { posts as samplePosts } from "@/lib/data";

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
  const { sucursalActiva } = useBranchStore();
  const [posts, setPosts] = useState<PostData[]>([]);
  const [auto, setAuto] = useState(false);
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  
  // Cargar datos reales de Supabase
  useEffect(() => {
    if (!sucursalActiva) {
      setPosts([]);
      return;
    }

    const fetchPosts = async () => {
      if (!supabase) {
        setPosts(samplePosts.map((p) => ({ ...p, id: String(p.id) })));
        return;
      }
      const { data, error } = await supabase
        .from('publicaciones')
        .select(`
          id, 
          texto_copy, 
          fecha_publicacion, 
          red_social, 
          estado, 
          activos (url_imagen, tags)
        `)
        .eq('sucursal_id', sucursalActiva.id);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sucursalActiva?.id]);

  const scheduled = posts.filter((p) => p.status === "programado").length;

  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copy copiado al portapapeles");
  };

  const handleDownloadImage = async (url: string) => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Error al obtener la imagen");
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `publicacion-${Date.now()}.jpg`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      toast.success("Imagen descargada correctamente");
    } catch (error) {
      console.error(error);
      toast.error("Error al descargar la imagen");
    }
  };

  const approve = async (id: string) => {
    // Actualización optimista en la UI
    setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, status: "programado" } : p)));
    
    if (!supabase) { toast.success("Publicación aprobada y programada"); return; }
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
    
    if (!supabase) { setEditing(null); toast.success("Texto actualizado y programado"); return; }
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

  if (!sucursalActiva) {
    return (
      <AppShell
        title={<span className="text-cta">AutoSocial AI - Panel de Control Automático</span>}
        subtitle="Próximas publicaciones generadas por IA"
      >
        <div className="flex min-h-[50vh] items-center justify-center">
          <Card className="max-w-md text-center shadow-card">
            <CardHeader className="items-center pb-2">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary-soft text-primary">
                <Store className="h-6 w-6" />
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-medium text-muted-foreground">
                Por favor, selecciona una sucursal en Configuración para ver las publicaciones
              </p>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title={<span className="text-cta">AutoSocial AI - Panel de Control Automático</span>} subtitle={`${sucursalActiva.nombre} · Próximas publicaciones generadas por IA`}>
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
            <div className="flex shrink-0 flex-wrap items-center gap-2 self-start sm:self-center">
              <Button
                variant="ghost"
                size="icon"
                title="Copiar Copy"
                onClick={() => handleCopyText(p.copy)}
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title="Descargar Imagen"
                onClick={() => handleDownloadImage(p.img)}
              >
                <Download className="h-4 w-4" />
              </Button>
              {p.status === "pendiente" && (
                <>
                  <Button variant="brand" onClick={() => approve(p.id)}>
                    <CheckCircle2 /> Aprobar y Programar
                  </Button>
                  <Button variant="outline" onClick={() => openEdit(p.id)}>
                    <Pencil /> Editar Copy
                  </Button>
                </>
              )}
            </div>
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