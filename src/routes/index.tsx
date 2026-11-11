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
  Repeat,
  Wand2,
  Send,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  MAX_POST_COPY_LENGTH,
  SUPPORTED_SOCIAL_NETWORKS,
  assets as sampleAssets,
  countPublishedThisMonth,
  formatScheduledDateLabel,
  hasAffectedRows,
  isZeroInventory,
  parseTags,
  posts as samplePosts,
  toDatetimeLocalInputValue,
  validatePostEditPayload,
  type Asset,
  type SocialNetwork,
} from "@/lib/data";
import {
  MAX_PUBLISH_ATTEMPTS,
  canTransitionPublishStatus,
  checkInstagramDailyQuota,
  isIntegrationTokenExpired,
  isMissingPublishColumnsError,
  normalizePublishStatus,
} from "@/lib/publish";
import { publishPostServerFn } from "@/lib/publish-server";
import { useBranchStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import type { PublishStatus } from "@/types";

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
  scheduledAtIso: string;
  publishedAtIso?: string | null | undefined;
  network: string;
  status: PublishStatus;
  img: string;
  pillar: string;
  assetId: string;
  lastError?: string | null | undefined;
  attempts?: number | undefined;
  externalId?: string | null | undefined;
};

type EditingPostState = {
  id: string;
  draft: string;
  network: SocialNetwork;
  scheduledAtLocal: string;
  assetId: string;
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

function getStatusBadgeProps(status: PublishStatus): {
  variant: "pending" | "scheduled" | "publishing" | "published" | "error";
  label: string;
} {
  switch (status) {
    case "pendiente":
      return { variant: "pending", label: "Pendiente de Aprobación" };
    case "programado":
      return { variant: "scheduled", label: "Programado" };
    case "publicando":
      return { variant: "publishing", label: "Publicando en Meta…" };
    case "publicado":
      return { variant: "published", label: "Publicado" };
    case "error":
      return { variant: "error", label: "Error de Publicación" };
  }
}

function Dashboard() {
  const { sucursalActiva } = useBranchStore();
  const [posts, setPosts] = useState<PostData[]>([]);
  const [branchAssets, setBranchAssets] = useState<Asset[]>([]);
  const [hasActiveIntegration, setHasActiveIntegration] = useState(true);
  const [isTokenExpired, setIsTokenExpired] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [publishingPostId, setPublishingPostId] = useState<string | null>(null);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [editing, setEditing] = useState<EditingPostState | null>(null);

  useEffect(() => {
    if (!sucursalActiva) {
      setPosts([]);
      setBranchAssets([]);
      return;
    }

    const fetchDashboardData = async () => {
      if (!supabase) {
        setPosts(
          samplePosts.map((p, idx) => {
            const fallbackDate = new Date(Date.now() + (idx + 1) * 3600 * 1000 * 6).toISOString();
            const matchedSampleAsset = sampleAssets.find((a) => a.img === p.img);
            return {
              ...p,
              id: String(p.id),
              status: normalizePublishStatus(p.status),
              scheduledAtIso: fallbackDate,
              assetId: matchedSampleAsset ? String(matchedSampleAsset.id) : "",
            };
          }),
        );
        setBranchAssets(sampleAssets);
        setHasActiveIntegration(true);
        setIsTokenExpired(false);
        return;
      }

      setIsLoading(true);
      try {
        const [extendedPostsRes, assetsRes, integrationsRes] = await Promise.all([
          supabase
            .from("publicaciones")
            .select(
              `
              id, 
              texto_copy, 
              fecha_publicacion, 
              red_social, 
              estado, 
              activo_id,
              ultimo_error,
              intentos,
              publicado_en,
              id_externo,
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

        let postsData = extendedPostsRes.data;
        let postsError = extendedPostsRes.error;

        if (postsError && isMissingPublishColumnsError(postsError)) {
          const fallbackPostsRes = await supabase
            .from("publicaciones")
            .select(
              `
              id, 
              texto_copy, 
              fecha_publicacion, 
              red_social, 
              estado, 
              activo_id,
              activos (url_imagen, tags)
            `,
            )
            .eq("sucursal_id", sucursalActiva.id)
            .order("created_at", { ascending: false });
          postsData = fallbackPostsRes.data as typeof postsData;
          postsError = fallbackPostsRes.error;
        }

        if (assetsRes.data) {
          const validAssets = assetsRes.data.filter(
            (d: any) => d.url_imagen && d.url_imagen !== "https://example.com/test.jpg",
          );
          setBranchAssets(
            validAssets.map((d: any, idx: number) => mapRowToAsset(d, idx)),
          );
        }

        if (integrationsRes.data) {
          const connected = integrationsRes.data.some(
            (i: any) =>
              Boolean(i.token_cifrado) && !String(i.token_cifrado).startsWith("token_"),
          );
          const expired = integrationsRes.data.some((i: any) =>
            isIntegrationTokenExpired(i),
          );
          setHasActiveIntegration(connected);
          setIsTokenExpired(expired);
        }

        if (postsData && !postsError) {
          const formattedPosts: PostData[] = postsData.map((d: any) => {
            const isoDate = d.fecha_publicacion || new Date().toISOString();
            return {
              id: d.id,
              copy: d.texto_copy,
              when: formatScheduledDateLabel(isoDate),
              scheduledAtIso: isoDate,
              publishedAtIso: d.publicado_en ?? null,
              network: d.red_social || "Instagram",
              status: normalizePublishStatus(d.estado),
              img: d.activos?.url_imagen || "",
              pillar: d.activos?.tags || "General",
              assetId: d.activo_id ? String(d.activo_id) : "",
              lastError: d.ultimo_error ?? null,
              attempts: typeof d.intentos === "number" ? d.intentos : 0,
              externalId: d.id_externo ?? null,
            };
          });
          setPosts(formattedPosts);
        } else if (postsError) {
          toast.error("Error cargando publicaciones");
          console.error(postsError);
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchDashboardData();
  }, [sucursalActiva?.id]);

  const scheduled = posts.filter((p) => p.status === "programado").length;
  const publishedThisMonth = countPublishedThisMonth(posts);
  const zeroInventory = !isLoading && isZeroInventory(branchAssets);
  const igQuotaStatus = checkInstagramDailyQuota(posts);

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
      const { aiResponse, matchedAsset, provider } =
        await generateSocialPostForBranch(
          sucursalActiva,
          branchAssets,
          posts.length,
        );

      const initialStatus = resolveInitialPostStatus(auto);
      const nextNetwork = posts.length % 2 === 0 ? "Instagram" : "Facebook";
      const scheduledDate = new Date(Date.now() + (posts.length + 1) * 3600 * 1000 * 6);
      const scheduledIso = scheduledDate.toISOString();
      const providerBadge =
        provider === "gemini"
          ? " con Gemini (gemini-3.8-flash)"
          : " vía Webhook IA";

      if (!supabase) {
        const mockPost: PostData = {
          id: `post-${Date.now()}`,
          copy: aiResponse.copy_text,
          when: formatScheduledDateLabel(scheduledIso),
          scheduledAtIso: scheduledIso,
          network: nextNetwork,
          status: normalizePublishStatus(initialStatus),
          img: matchedAsset.img,
          pillar: matchedAsset.tags.join(", ") || "General",
          assetId: String(matchedAsset.id),
        };
        setPosts((prev) => [mockPost, ...prev]);
        toast.success(`Publicación generada${providerBadge}`);
        return;
      }

      const { data: inserted, error: insertError } = await supabase
        .from("publicaciones")
        .insert([
          {
            sucursal_id: sucursalActiva.id,
            texto_copy: aiResponse.copy_text,
            fecha_publicacion: scheduledIso,
            red_social: nextNetwork,
            estado: initialStatus,
            activo_id: String(matchedAsset.id),
          },
        ])
        .select()
        .single();

      if (insertError) throw insertError;

      if (inserted) {
        const createdIso = inserted.fecha_publicacion || scheduledIso;
        const createdPost: PostData = {
          id: inserted.id,
          copy: inserted.texto_copy,
          when: formatScheduledDateLabel(createdIso),
          scheduledAtIso: createdIso,
          network: inserted.red_social,
          status: normalizePublishStatus(inserted.estado),
          img: matchedAsset.img,
          pillar: matchedAsset.tags.join(", ") || "General",
          assetId: String(matchedAsset.id),
        };
        setPosts((prev) => [createdPost, ...prev]);
      }

      toast.success(
        initialStatus === "programado"
          ? `Publicación generada${providerBadge} y programada automáticamente`
          : `Publicación generada${providerBadge} (Pendiente de Aprobación)`,
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
    const post = posts.find((p) => p.id === id);
    if (!post) return;

    const check = canTransitionPublishStatus(post.status, "programado");
    if (!check.valid) {
      toast.error(check.reason ?? "No se puede aprobar esta publicación.");
      return;
    }

    setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, status: "programado" } : p)));

    if (!supabase) {
      toast.success("Publicación aprobada y programada");
      return;
    }
    const { data, error } = await supabase
      .from("publicaciones")
      .update({ estado: "programado" })
      .eq("id", id)
      .select();

    if (error || !hasAffectedRows(data)) {
      toast.error("Hubo un error al guardar en la base de datos");
      setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, status: "pendiente" } : p)));
    } else {
      toast.success("Publicación aprobada y programada");
    }
  };

  const handlePublishPost = async (
    id: string,
    options?: { explicitRetry?: boolean | undefined },
  ) => {
    const post = posts.find((p) => p.id === id);
    if (!post) return;

    const explicitRetry = Boolean(options?.explicitRetry);

    if (post.status === "error" && explicitRetry) {
      const retryCheck = canTransitionPublishStatus("error", "programado", {
        explicitRetry: true,
        hasExternalId: Boolean(post.externalId),
      });
      if (!retryCheck.valid) {
        toast.error(retryCheck.reason ?? "No se puede reintentar esta publicación.");
        return;
      }
    } else {
      const claimCheck = canTransitionPublishStatus(post.status, "publicando", {
        hasExternalId: Boolean(post.externalId),
      });
      if (!claimCheck.valid) {
        toast.error(claimCheck.reason ?? "Esta publicación no puede enviarse en su estado actual.");
        return;
      }
    }

    if (post.network === "Instagram") {
      const quota = checkInstagramDailyQuota(posts);
      if (!quota.allowed) {
        const quotaMsg =
          quota.reason ??
          "Se alcanzó el límite de 25 publicaciones en 24 horas para esta cuenta de Instagram.";
        toast.error(quotaMsg);
        setPosts((ps) =>
          ps.map((p) =>
            p.id === id ? { ...p, status: "error", lastError: quotaMsg } : p,
          ),
        );
        return;
      }
    }

    setPublishingPostId(id);
    setPosts((ps) =>
      ps.map((p) =>
        p.id === id ? { ...p, status: "publicando", lastError: null } : p,
      ),
    );

    if (!supabase) {
      const nowIso = new Date().toISOString();
      const mockExternalId = `meta-${Date.now()}`;
      setPosts((ps) =>
        ps.map((p) =>
          p.id === id
            ? {
                ...p,
                status: "publicado",
                publishedAtIso: nowIso,
                externalId: mockExternalId,
                lastError: null,
                attempts: (p.attempts ?? 0) + 1,
              }
            : p,
        ),
      );
      if (post.assetId) {
        setBranchAssets((prev) =>
          prev.map((a) =>
            String(a.id) === post.assetId ? { ...a, uses: a.uses + 1 } : a,
          ),
        );
      }
      setPublishingPostId(null);
      toast.success(`Publicado exitosamente en ${post.network}`);
      return;
    }

    try {
      const result = await publishPostServerFn({
        data: {
          publicacionId: id,
          explicitRetry,
        },
      });

      if (result.ok && result.status === "publicado") {
        setPosts((ps) =>
          ps.map((p) =>
            p.id === id
              ? {
                  ...p,
                  status: "publicado",
                  publishedAtIso: result.publishedAtIso ?? new Date().toISOString(),
                  externalId: result.externalId ?? p.externalId ?? null,
                  lastError: null,
                  attempts: result.attempts ?? (p.attempts ?? 0) + 1,
                }
              : p,
          ),
        );

        const targetAssetId = result.assetId ?? post.assetId;
        if (targetAssetId) {
          setBranchAssets((prev) =>
            prev.map((a) =>
              String(a.id) === String(targetAssetId)
                ? {
                    ...a,
                    uses:
                      typeof result.assetUses === "number"
                        ? result.assetUses
                        : a.uses + 1,
                  }
                : a,
            ),
          );
        }

        toast.success(`Publicación enviada y publicada en ${post.network}`);
      } else {
        const errText =
          result.errorMessage ??
          "No se pudo completar la publicación en Meta Graph API.";
        if (result.pauseIntegration) {
          setIsTokenExpired(true);
        }
        setPosts((ps) =>
          ps.map((p) =>
            p.id === id
              ? {
                  ...p,
                  status: result.status,
                  lastError: errText,
                  attempts: result.attempts ?? (p.attempts ?? 0) + 1,
                }
              : p,
          ),
        );
        toast.error(errText);
      }
    } catch (error: any) {
      const fallbackMsg =
        error?.message ?? "Error al comunicar con la función de publicación.";
      setPosts((ps) =>
        ps.map((p) =>
          p.id === id
            ? {
                ...p,
                status: "error",
                lastError: fallbackMsg,
                attempts: (p.attempts ?? 0) + 1,
              }
            : p,
        ),
      );
      toast.error(fallbackMsg);
    } finally {
      setPublishingPostId(null);
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
      const { data: deletedRows, error } = await supabase
        .from("publicaciones")
        .delete()
        .eq("id", id)
        .select();
      if (error) throw error;
      if (!hasAffectedRows(deletedRows)) {
        toast.error(
          "Supabase bloqueó el borrado (0 filas afectadas). Activa la política RLS de DELETE para la tabla 'publicaciones'.",
        );
        return;
      }
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
      setPosts((ps) =>
        ps.map((p) => (p.status === "pendiente" ? { ...p, status: "programado" } : p)),
      );
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
    if (!post || post.status === "publicado") return;

    const matchedByImg = branchAssets.find((a) => a.img === post.img);
    const resolvedAssetId =
      post.assetId || (matchedByImg ? String(matchedByImg.id) : String(branchAssets[0]?.id ?? ""));

    setEditing({
      id: post.id,
      draft: post.copy,
      network: post.network === "Facebook" ? "Facebook" : "Instagram",
      scheduledAtLocal: toDatetimeLocalInputValue(post.scheduledAtIso),
      assetId: resolvedAssetId,
    });
  };

  const savePostEdit = async () => {
    if (!editing) return;

    const validation = validatePostEditPayload({
      copy: editing.draft,
      network: editing.network,
      scheduledAtLocal: editing.scheduledAtLocal,
    });

    if (
      !validation.valid ||
      !validation.normalizedCopy ||
      !validation.network ||
      !validation.scheduledIso
    ) {
      toast.error(validation.reason ?? "Datos de publicación inválidos");
      return;
    }

    const currentPost = posts.find((p) => p.id === editing.id);
    const selectedAsset = branchAssets.find((a) => String(a.id) === editing.assetId);
    const nextImg = selectedAsset ? selectedAsset.img : (currentPost?.img ?? "");
    const nextPillar = selectedAsset
      ? selectedAsset.tags.join(", ") || "General"
      : (currentPost?.pillar ?? "General");
    const nextAssetId = selectedAsset ? String(selectedAsset.id) : (currentPost?.assetId ?? "");
    const nextWhen = formatScheduledDateLabel(validation.scheduledIso);

    if (!supabase) {
      setPosts((ps) =>
        ps.map((p) =>
          p.id === editing.id
            ? {
                ...p,
                copy: validation.normalizedCopy!,
                network: validation.network!,
                scheduledAtIso: validation.scheduledIso!,
                when: nextWhen,
                img: nextImg,
                pillar: nextPillar,
                assetId: nextAssetId,
                status: "programado",
                lastError: null,
              }
            : p,
        ),
      );
      setEditing(null);
      toast.success("Publicación actualizada y programada");
      return;
    }

    const updatePayload: Record<string, unknown> = {
      texto_copy: validation.normalizedCopy,
      red_social: validation.network,
      fecha_publicacion: validation.scheduledIso,
      estado: "programado",
    };
    if (nextAssetId) {
      updatePayload["activo_id"] = nextAssetId;
    }

    const { data, error } = await supabase
      .from("publicaciones")
      .update(updatePayload)
      .eq("id", editing.id)
      .select();

    if (error || !hasAffectedRows(data)) {
      toast.error("Error guardando los cambios de la publicación en Supabase");
      return;
    }

    setPosts((ps) =>
      ps.map((p) =>
        p.id === editing.id
          ? {
              ...p,
              copy: validation.normalizedCopy!,
              network: validation.network!,
              scheduledAtIso: validation.scheduledIso!,
              when: nextWhen,
              img: nextImg,
              pillar: nextPillar,
              assetId: nextAssetId,
              status: "programado",
              lastError: null,
            }
          : p,
      ),
    );
    setEditing(null);
    toast.success("Publicación actualizada y programada en Supabase");
  };

  const stats = [
    { label: "Posts Programados", value: scheduled, icon: CalendarClock, tone: "bg-primary-soft text-primary" },
    { label: "Publicados este mes", value: publishedThisMonth, icon: CheckCircle2, tone: "bg-success-soft text-success" },
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
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to="/activos">Subir Activos</Link>
              </Button>
              <Button variant="brand" size="sm" asChild>
                <Link to="/activos" search={{ prompts: true }}>
                  <Wand2 className="h-3.5 w-3.5" />
                  Generar Prompts con IA
                </Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {isTokenExpired && (
        <Alert variant="destructive" className="mb-5 rounded-xl">
          <TriangleAlert className="h-5 w-5" />
          <AlertTitle>Token de Meta expirado o revocado (Código 190)</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>
              El despacho automático se pausó inmediatamente para evitar reintentos en bucle. Actualiza el token en Ajustes → Integraciones.
            </span>
            <Button variant="outline" size="sm" asChild>
              <Link to="/settings">Renovar Token</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!igQuotaStatus.allowed && (
        <Alert variant="warning" className="mb-5 rounded-xl">
          <TriangleAlert className="h-5 w-5" />
          <AlertTitle className="text-warning">
            Límite diario de Instagram alcanzado ({igQuotaStatus.publishedLast24h}/25 en 24 h)
          </AlertTitle>
          <AlertDescription>
            {igQuotaStatus.reason}
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && !hasActiveIntegration && !isTokenExpired && (
        <Alert className="mb-5 rounded-xl">
          <Plug className="h-5 w-5" />
          <AlertTitle>Publicación manual o vía Secret de Servidor</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Puedes publicar usando el secret <code>META_PAGE_ACCESS_TOKEN</code> del servidor o configurar los datos de la página en Ajustes.
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
        {posts.map((p) => {
          const badge = getStatusBadgeProps(p.status);
          const isPublishingThis = publishingPostId === p.id || p.status === "publicando";
          const articleClasses =
            p.status === "pendiente"
              ? "border border-warning bg-warning-soft"
              : p.status === "error"
                ? "border border-destructive/40 bg-card"
                : "border bg-card";

          return (
            <article
              key={p.id}
              className={`flex flex-col gap-4 rounded-2xl p-4 shadow-card sm:flex-row ${articleClasses}`}
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
                  <Badge variant={badge.variant} className="rounded-full px-2.5 py-1">
                    {p.status === "publicando" && (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    )}
                    {badge.label}
                  </Badge>
                  {p.externalId && (
                    <span className="rounded-full bg-success-soft px-2.5 py-1 text-success">
                      ID Meta: {p.externalId}
                    </span>
                  )}
                </div>
                <p className="mt-3 text-sm leading-relaxed">{p.copy}</p>

                {p.status === "error" && (
                  <div
                    role="alert"
                    className="mt-3 flex flex-col gap-1 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
                  >
                    <div className="flex items-center justify-between gap-2 font-semibold">
                      <span className="inline-flex items-center gap-1.5">
                        <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                        Detalle del error en Meta Graph API
                      </span>
                      {typeof p.attempts === "number" && p.attempts > 0 && (
                        <span>
                          Intentos: {p.attempts}/{MAX_PUBLISH_ATTEMPTS}
                        </span>
                      )}
                    </div>
                    <p className="text-foreground/90">
                      {p.lastError ||
                        "No se pudo publicar en Meta. Revisa la conexión o pulsa Reintentar."}
                    </p>
                  </div>
                )}
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
                  disabled={deletingPostId === p.id || isPublishingThis}
                  onClick={() => handleDeletePost(p.id)}
                >
                  {deletingPostId === p.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 text-destructive" />
                  )}
                </Button>

                {p.status === "pendiente" && (
                  <Button variant="brand" onClick={() => approve(p.id)}>
                    <CheckCircle2 /> Aprobar y Programar
                  </Button>
                )}

                {p.status === "programado" && (
                  <Button
                    variant="cta"
                    disabled={isPublishingThis}
                    onClick={() => handlePublishPost(p.id, { explicitRetry: false })}
                  >
                    {isPublishingThis ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Send />
                    )}
                    {isPublishingThis ? "Publicando..." : "Publicar ahora"}
                  </Button>
                )}

                {p.status === "error" && (
                  <Button
                    variant="cta"
                    disabled={isPublishingThis}
                    onClick={() => handlePublishPost(p.id, { explicitRetry: true })}
                  >
                    {isPublishingThis ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <RotateCcw />
                    )}
                    Reintentar
                  </Button>
                )}

                {p.status !== "publicado" && p.status !== "publicando" && (
                  <Button variant="outline" onClick={() => openEdit(p.id)}>
                    <Pencil /> {p.status === "pendiente" ? "Editar" : "Reprogramar"}
                  </Button>
                )}
              </div>
            </article>
          );
        })}
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
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Editar y Programar Publicación</DialogTitle>
            <DialogDescription>
              Personaliza la red social, fecha y hora exacta, imagen asociada y texto del post.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Red Social</Label>
                <div className="grid grid-cols-2 gap-2">
                  {SUPPORTED_SOCIAL_NETWORKS.map((net) => {
                    const isSelected = editing?.network === net;
                    return (
                      <button
                        key={net}
                        type="button"
                        onClick={() =>
                          setEditing((prev) => (prev ? { ...prev, network: net } : prev))
                        }
                        className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition ${
                          isSelected
                            ? "border-primary bg-primary-soft text-primary"
                            : "bg-card hover:bg-muted"
                        }`}
                      >
                        {net === "Instagram" ? (
                          <Instagram className="h-4 w-4 text-violet" />
                        ) : (
                          <Facebook className="h-4 w-4 text-primary" />
                        )}
                        {net}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="post-schedule-datetime">Fecha y Hora de Publicación</Label>
                <Input
                  id="post-schedule-datetime"
                  type="datetime-local"
                  value={editing?.scheduledAtLocal ?? ""}
                  onChange={(e) =>
                    setEditing((prev) =>
                      prev ? { ...prev, scheduledAtLocal: e.target.value } : prev,
                    )
                  }
                />
              </div>
            </div>

            {branchAssets.length > 0 && (
              <div className="space-y-2">
                <Label>Activo Visual Asociado ({branchAssets.length} disponibles)</Label>
                <div className="grid max-h-48 grid-cols-3 gap-2.5 overflow-y-auto rounded-xl border bg-muted/30 p-2.5 sm:grid-cols-4">
                  {branchAssets.map((asset) => {
                    const isSelected = editing?.assetId === String(asset.id);
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() =>
                          setEditing((prev) =>
                            prev ? { ...prev, assetId: String(asset.id) } : prev,
                          )
                        }
                        className={`group relative overflow-hidden rounded-xl border text-left transition ${
                          isSelected
                            ? "border-primary bg-primary-soft ring-2 ring-primary/30"
                            : "bg-card hover:border-primary/50"
                        }`}
                      >
                        <img
                          src={asset.img}
                          alt={asset.name}
                          className="aspect-square w-full object-cover"
                        />
                        <div className="p-1.5">
                          <p className="truncate text-[11px] font-semibold">{asset.name}</p>
                          <p className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Repeat className="h-2.5 w-2.5" /> Usos: {asset.uses}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="post-copy-textarea">Texto del Copy</Label>
              <Textarea
                id="post-copy-textarea"
                value={editing?.draft ?? ""}
                onChange={(e) =>
                  setEditing((prev) => (prev ? { ...prev, draft: e.target.value } : prev))
                }
                rows={5}
                maxLength={MAX_POST_COPY_LENGTH}
                placeholder="Escribe el texto de la publicación…"
              />
              <p className="text-right text-xs text-muted-foreground">
                {editing?.draft.length ?? 0}/{MAX_POST_COPY_LENGTH}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button variant="brand" onClick={savePostEdit}>
              <CheckCircle2 /> Guardar y Programar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
