import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ImageIcon,
  Instagram,
  Facebook,
  Clock,
  Bot,
  ShieldCheck,
  Pencil,
  Download,
  Copy,
  Store,
  Sparkles,
  Loader2,
  Trash2,
  TriangleAlert,
  Plug,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  generateSocialPostForBranch,
  resolveInitialPostStatus,
} from "@/lib/ai-engine";
import {
  assets as sampleAssets,
  isZeroInventory,
  parseTags,
  posts as samplePosts,
  type Asset,
} from "@/lib/data";
import { useBranchStore } from "@/lib/store";
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

type PostData = {
  id: string;
  copy: string;
  when: string;
  network: string;
  status: string;
  img: string;
  pillar: string;
};

function mapRowToAsset(d: any, index: number): Asset {
  const parsedTags = parseTags(d.tags);
  return {
    id: d.id ?? index + 1,
    img: d.url_imagen || "",
    name: parsedTags[0] || `Activo ${index + 1}`,
    tags: parsedTags.length > 0 ? parsedTags : ["#producto"],
    uses: typeof d.contador_uso === "number" ? d.contador_uso : 0,
  };
}

function Dashboard() {
  const { sucursalActiva } = useBranchStore();
  const [posts, setPosts] = useState<PostData[]>([]);
  const [branchAssets, setBranchAssets] = useState<Asset[]>([]);
  const [hasActiveIntegration, setHasActiveIntegration] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);

  useEffect(() => {
    if (!sucursalActiva) {
      setPosts([]);
      setBranchAssets([]);
      return;
    }

    const fetchDashboardData = async () => {
      if (!supabase) {
        setPosts(samplePosts.map((p) => ({ ...p, id: String(p.id) })));
        setBranchAssets(sampleAssets);
        setHasActiveIntegration(true);
        return;
      }

      setIsLoading(true);
      try {
        const [postsRes, assetsRes, integrationsRes] = await Promise.all([
          supabase
            .from("publicaciones")
            .select(
              `
              id, 
              texto_copy, 
              fecha_publicacion, 
              red_social, 
              estado, 
              activos (url_imagen, tags)
            `,
            )
            .eq("sucursal_id", sucursalActiva.id)
            .order("created_at", { ascending: false }),
          supabase
            .from("activos")
            .select("*")
            .eq("sucursal_id", sucursalActiva.id),
          supabase
            .from("integraciones_sociales")
            .select("*")
            .eq("sucursal_id", sucursalActiva.id),
        ]);

        if (assetsRes.data) {
          setBranchAssets(
            assetsRes.data.map((d: any, idx: number) => mapRowToAsset(d, idx)),
          );
        }

        if (integrationsRes.data) {
          const connected = integrationsRes.data.some((i: any) =>
            Boolean(i.token_cifrado),
          );
          setHasActiveIntegration(connected);
        }

        if (postsRes.data && !postsRes.error) {
          const formattedPosts = postsRes.data.map((d: any) => ({
            id: d.id,
            copy: d.texto_copy,
            when: new Date(d.fecha_publicacion).toLocaleString("es-CO", {
              dateStyle: "short",
              timeStyle: "short",
            }),
            network: d.red_social,
            status: d.estado,
            img: d.activos?.url_imagen || "",
            pillar: d.activos?.tags || "General",
          }));
          setPosts(formattedPosts);
        } else if (postsRes.error) {
          toast.error("Error cargando publicaciones");
          console.error(postsRes.error);
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchDashboardData();
  }, [sucursalActiva?.id]);

  const scheduled = posts.filter(
    (p) => p.status === "programado" || p.status === "programada",
  ).length;
  const zeroInventory = !isLoading && isZeroInventory(branchAssets);

  const handleGeneratePost = async () => {
    if (!sucursalActiva) return;
    if (isZeroInventory(branchAssets)) {
      toast.error(
        "Banco de Contenido Agotado: Sube al menos una imagen en Activos antes de generar.",
      );
      return;
    }

    setIsGenerating(true);
    try {
      const { aiResponse, matchedAsset } = await generateSocialPostForBranch(
        sucursalActiva,
        branchAssets,
        posts.length,
      );

      const initialStatus = resolveInitialPostStatus(auto);
      const nextNetwork = posts.length % 2 === 0 ? "Instagram" : "Facebook";
      const scheduledDate = new Date(Date.now() + (posts.length + 1) * 3600 * 1000 * 6);
      const nextUses = matchedAsset.uses + 1;

      if (!supabase) {
        const mockPost: PostData = {
          id: `post-${Date.now()}`,
          copy: aiResponse.copy_text,
          when: scheduledDate.toLocaleString("es-CO", {
            dateStyle: "short",
            timeStyle: "short",
          }),
          network: nextNetwork,
          status: initialStatus,
          img: matchedAsset.img,
          pillar: matchedAsset.tags.join(", ") || "General",
        };
        setPosts((prev) => [mockPost, ...prev]);
        setBranchAssets((prev) =>
          prev.map((a) => (a.id === matchedAsset.id ? { ...a, uses: nextUses } : a)),
        );
        toast.success("Publicación generada con IA");
        return;
      }

      const { data: inserted, error: insertError } = await supabase
        .from("publicaciones")
        .insert([
          {
            sucursal_id: sucursalActiva.id,
            texto_copy: aiResponse.copy_text,
            fecha_publicacion: scheduledDate.toISOString(),
            red_social: nextNetwork,
            estado: initialStatus,
            activo_id: String(matchedAsset.id),
          },
        ])
        .select()
        .single();

      if (insertError) throw insertError;

      await supabase
        .from("activos")
        .update({ contador_uso: nextUses })
        .eq("id", String(matchedAsset.id));

      setBranchAssets((prev) =>
        prev.map((a) => (a.id === matchedAsset.id ? { ...a, uses: nextUses } : a)),
      );

      if (inserted) {
        const createdPost: PostData = {
          id: inserted.id,
          copy: inserted.texto_copy,
          when: new Date(inserted.fecha_publicacion).toLocaleString("es-CO", {
            dateStyle: "short",
            timeStyle: "short",
          }),
          network: inserted.red_social,
          status: inserted.estado,
          img: matchedAsset.img,
          pillar: matchedAsset.tags.join(", ") || "General",
        };
        setPosts((prev) => [createdPost, ...prev]);
      }

      toast.success(
        initialStatus === "programado"
          ? "Publicación generada y programada automáticamente"
          : "Publicación generada (Pendiente de Aprobación)",
      );
    } catch (error: any) {
      console.error(error);
      toast.error(
        error?.message
          ? `Error al generar publicación: ${error.message}`
          : "No se pudo generar la publicación",
      );
    } finally {
      setIsGenerating(false);
    }
  };

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
    setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, status: "programado" } : p)));

    if (!supabase) {
      toast.success("Publicación aprobada y programada");
      return;
    }
    const { error } = await supabase
      .from("publicaciones")
      .update({ estado: "programado" })
      .eq("id", id);

    if (error) {
      toast.error("Hubo un error al guardar en la base de datos");
      setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, status: "pendiente" } : p)));
    } else {
      toast.success("Publicación aprobada y programada");
    }
  };

  const handleDeletePost = async (id: string) => {
    setDeletingPostId(id);
    if (!supabase) {
      setPosts((ps) => ps.filter((p) => p.id !== id));
      setDeletingPostId(null);
      toast.success("Publicación eliminada");
      return;
    }

    try {
      const { error } = await supabase.from("publicaciones").delete().eq("id", id);
      if (error) throw error;
      setPosts((ps) => ps.filter((p) => p.id !== id));
      toast.success("Publicación eliminada");
    } catch (error: any) {
      console.error(error);
      toast.error(
        error?.message
          ? `Error al eliminar publicación: ${error.message}`
          : "No se pudo eliminar la publicación",
      );
    } finally {
      setDeletingPostId(null);
    }
  };

  const toggle = async (v: boolean) => {
    setAuto(v);
    if (v) {
      setPosts((ps) => ps.map((p) => ({ ...p, status: "programado" })));
      if (supabase && sucursalActiva) {
        await supabase
          .from("publicaciones")
          .update({ estado: "programado" })
          .eq("sucursal_id", sucursalActiva.id)
          .eq("estado", "pendiente");
      }
    }
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

    setPosts((ps) =>
      ps.map((p) => (p.id === editing.id ? { ...p, copy: text, status: "programado" } : p)),
    );

    if (!supabase) {
      setEditing(null);
      toast.success("Texto actualizado y programado");
      return;
    }
    const { error } = await supabase
      .from("publicaciones")
      .update({ texto_copy: text, estado: "programado" })
      .eq("id", editing.id);

    setEditing(null);

    if (error) toast.error("Error guardando el texto");
    else toast.success("Texto actualizado y programado");
  };

  const stats = [
    { label: "Posts Programados", value: scheduled, icon: CalendarClock, tone: "bg-primary-soft text-primary" },
    { label: "Publicados este mes", value: 24, icon: CheckCircle2, tone: "bg-success-soft text-success" },
    { label: "Activos Disponibles en Galería", value: branchAssets.length, icon: ImageIcon, tone: "bg-violet-soft text-violet" },
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
    <AppShell
      title={<span className="text-cta">AutoSocial AI - Panel de Control Automático</span>}
      subtitle={`${sucursalActiva.nombre} · Próximas publicaciones generadas por IA`}
      action={
        <Button
          variant="brand"
          size="lg"
          disabled={isGenerating || zeroInventory}
          onClick={handleGeneratePost}
        >
          {isGenerating ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {isGenerating ? "Generando con IA..." : "Generar Publicación con IA"}
        </Button>
      }
    >
      {zeroInventory && (
        <Alert variant="warning" className="mb-5 rounded-xl">
          <TriangleAlert className="h-5 w-5" />
          <AlertTitle className="text-warning">
            Banco de Contenido Agotado (Inventario Cero)
          </AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Esta sucursal no tiene imágenes disponibles. Por seguridad, el bot detiene la generación para nunca publicar texto suelto en Meta.
            </span>
            <Button variant="outline" size="sm" asChild>
              <Link to="/activos">Subir Activos</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && !hasActiveIntegration && (
        <Alert className="mb-5 rounded-xl">
          <Plug className="h-5 w-5" />
          <AlertTitle>Publicación manual activa (Meta API desconectada)</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Conecta tu cuenta en Ajustes para despacho automático o usa los botones de copiar texto y descargar imagen.
            </span>
            <Button variant="outline" size="sm" asChild>
              <Link to="/settings">Ir a Integraciones</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="flex items-center gap-4 rounded-2xl border bg-card p-5 shadow-card">
            <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${s.tone}`}>
              <s.icon className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <p className="font-display text-2xl font-bold">{s.value}</p>
              <p className="text-sm text-muted-foreground">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand text-primary-foreground">
            {auto ? <Bot className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
          </div>
          <div>
            <p className="font-semibold">
              {auto ? "Modo Autónomo" : "Modo Supervisado (Aprobación Manual)"}
            </p>
            <p className="text-sm text-muted-foreground">
              {auto
                ? "La IA programa automáticamente sin revisión manual."
                : "Revisas y apruebas cada post antes de programarse."}
            </p>
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
          <article
            key={p.id}
            className={`flex flex-col gap-4 rounded-2xl p-4 shadow-card sm:flex-row ${p.status === "pendiente" ? "border border-warning bg-warning-soft" : "border bg-card"}`}
          >
            <img
              src={p.img}
              alt={p.pillar}
              loading="lazy"
              width={816}
              height={816}
              className="aspect-square w-full rounded-xl object-cover sm:w-28"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
                  {p.network === "Instagram" ? (
                    <Instagram className="h-3.5 w-3.5 text-violet" />
                  ) : (
                    <Facebook className="h-3.5 w-3.5 text-primary" />
                  )}
                  {p.network}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
                  <Clock className="h-3.5 w-3.5" />
                  {p.when}
                </span>
                <span className="rounded-full bg-violet-soft px-2.5 py-1 text-violet">
                  {p.pillar}
                </span>
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
              <Button
                variant="ghost"
                size="icon"
                title="Eliminar publicación"
                disabled={deletingPostId === p.id}
                onClick={() => handleDeletePost(p.id)}
              >
                {deletingPostId === p.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 text-destructive" />
                )}
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
        {isLoading && (
          <p className="py-4 text-sm text-muted-foreground">Cargando publicaciones...</p>
        )}
        {!isLoading && posts.length === 0 && (
          <div className="rounded-2xl border border-dashed bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No hay publicaciones para esta sucursal todavía.
            </p>
            {!zeroInventory && (
              <Button variant="outline" className="mt-4" onClick={handleGeneratePost} disabled={isGenerating}>
                <Sparkles className="h-4 w-4" /> Generar la primera publicación con IA
              </Button>
            )}
          </div>
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
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button variant="brand" onClick={saveCopy}>
              <CheckCircle2 /> Guardar y Programar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
