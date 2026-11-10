import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  Copy,
  ImagePlus,
  Loader2,
  Palette,
  Pencil,
  Plus,
  Repeat,
  Sparkles,
  Store,
  Trash2,
  TriangleAlert,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_WEEKLY_IMAGE_ASPECT_RATIO,
  WEEKLY_IMAGE_ASPECT_RATIO_LABELS,
  WEEKLY_IMAGE_ASPECT_RATIOS,
  analyzeAssetImageTags,
  calculateWeeklyBatchPlan,
  generateWeeklyImagePromptsWithAI,
  summarizeWeeklyBatchPlan,
  type WeeklyImageAspectRatio,
  type WeeklyVisualPromptItem,
} from "@/lib/ai-engine";
import {
  BRAND_LOGO_TAG,
  BRAND_REFERENCE_TAG,
  extractBrandReferenceAssets,
  hasBrandTag,
  normalizeBrandKit,
  toggleBrandTag,
  type BrandTag,
} from "@/lib/brand";
import {
  assets as sampleAssets,
  countUnused,
  extractStoragePath,
  formatTagsString,
  hasAffectedRows,
  inferTagsFromFilename,
  isLowStock,
  parseTags,
  readImageDimensions,
  validateAssetFile,
  validateImageDimensions,
  type Asset,
} from "@/lib/data";
import { useBranchStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";

/** Cantidades de piezas ofrecidas en el generador de prompts. */
const WEEKLY_PROMPT_COUNT_OPTIONS = [1, 3, 5] as const;

export const Route = createFileRoute("/activos")({
  validateSearch: (search: Record<string, unknown>): { prompts?: boolean } => {
    const wantsPrompts =
      search["prompts"] === true ||
      search["prompts"] === "1" ||
      search["prompts"] === 1;
    return wantsPrompts ? { prompts: true } : {};
  },
  head: () => ({
    meta: [
      { title: "Biblioteca de Activos — AutoSocial AI" },
      { name: "description", content: "Galería de imágenes con etiquetas automáticas y contador de uso." },
      { property: "og:title", content: "Biblioteca de Activos — AutoSocial AI" },
      { property: "og:description", content: "Galería de imágenes con etiquetas automáticas y contador de uso." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Activos,
});

function mapRowToAsset(d: any, index: number): Asset {
  const parsedTags = parseTags(d.tags);
  return {
    id: d.id ?? index + 1,
    img: d.url_imagen || "",
    name: parsedTags[0] || `Activo ${index + 1}`,
    tags: parsedTags.length > 0 ? parsedTags : ["#producto"],
    uses:
      typeof d.contador_uso === "number"
        ? d.contador_uso
        : typeof d.usos === "number"
          ? d.usos
          : typeof d.uses === "number"
            ? d.uses
            : 0,
  };
}

function Activos() {
  const { sucursalActiva } = useBranchStore();
  const { prompts: openPromptsOnLoad } = Route.useSearch();
  const [assetsList, setAssetsList] = useState<Asset[]>([]);
  const [tag, setTag] = useState("Todos");
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzingVision, setIsAnalyzingVision] = useState(false);
  const [deletingId, setDeletingId] = useState<string | number | null>(null);
  const [editingTags, setEditingTags] = useState<{
    id: string | number;
    draft: string;
    img: string;
    name: string;
  } | null>(null);
  const [isPromptsDialogOpen, setIsPromptsDialogOpen] = useState(false);
  const [promptCount, setPromptCount] = useState<number>(3);
  const [promptAspectRatio, setPromptAspectRatio] = useState<WeeklyImageAspectRatio>(
    DEFAULT_WEEKLY_IMAGE_ASPECT_RATIO,
  );
  const [promptCampaign, setPromptCampaign] = useState("");
  const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(false);
  const [promptItems, setPromptItems] = useState<WeeklyVisualPromptItem[]>([]);
  const [promptMeta, setPromptMeta] = useState<{
    model: string;
    references: number;
    aspectRatio: WeeklyImageAspectRatio;
  } | null>(null);
  const [togglingBrandId, setTogglingBrandId] = useState<string | number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const brandKit = normalizeBrandKit(sucursalActiva?.brand_kit);
  const brandReferenceAssets = extractBrandReferenceAssets(assetsList, 2);
  const brandKitColors = [
    { label: "Primario", value: brandKit.primary_color },
    { label: "Secundario", value: brandKit.secondary_color },
    { label: "Acento", value: brandKit.accent_color },
  ].filter((entry): entry is { label: string; value: string } => Boolean(entry.value));

  useEffect(() => {
    if (openPromptsOnLoad) {
      setIsPromptsDialogOpen(true);
    }
  }, [openPromptsOnLoad]);

  useEffect(() => {
    setTag("Todos");

    if (!sucursalActiva) {
      setAssetsList([]);
      return;
    }

    const fetchActivos = async () => {
      if (!supabase) {
        setAssetsList(sampleAssets);
        return;
      }

      const { data, error } = await supabase
        .from("activos")
        .select("*")
        .eq("sucursal_id", sucursalActiva.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error(error);
        toast.error("Error cargando los activos de la sucursal");
        return;
      }

      if (data) {
        const validRows = data.filter(
          (d: any) => d.url_imagen && d.url_imagen !== "https://example.com/test.jpg",
        );
        setAssetsList(validRows.map((d: any, index: number) => mapRowToAsset(d, index)));
      }
    };

    fetchActivos();
  }, [sucursalActiva?.id]);

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!sucursalActiva) {
      toast.error("Por favor, selecciona una sucursal antes de subir un activo");
      event.target.value = "";
      return;
    }

    const validation = validateAssetFile(file);
    if (!validation.valid) {
      toast.error(validation.reason ?? "Archivo inválido");
      event.target.value = "";
      return;
    }

    let formatLabel = "Feed";
    try {
      const { width, height } = await readImageDimensions(file);
      const dimValidation = validateImageDimensions(width, height);
      if (!dimValidation.valid) {
        toast.error(
          dimValidation.reason ??
            "Dimensiones o relación de aspecto no compatibles con Meta API",
        );
        event.target.value = "";
        return;
      }
      formatLabel = dimValidation.format === "STORY" ? "Stories (9:16)" : "Feed";
    } catch (dimError: any) {
      toast.error(
        dimError?.message ?? "No se pudieron verificar las dimensiones de la imagen.",
      );
      event.target.value = "";
      return;
    }

    if (!supabase) {
      toast.error("No hay conexión configurada con Supabase");
      event.target.value = "";
      return;
    }

    setIsUploading(true);
    const loadingToast = toast.loading("Subiendo activo a la galería...");

    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileName = `${sucursalActiva.id}/${Date.now()}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("galeria")
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("galeria").getPublicUrl(fileName);

      const autoTags = formatTagsString(inferTagsFromFilename(file.name).join(", "));

      const { data: inserted, error: insertError } = await supabase
        .from("activos")
        .insert([
          {
            sucursal_id: sucursalActiva.id,
            url_imagen: publicUrl,
            tags: autoTags,
            contador_uso: 0,
          },
        ])
        .select()
        .single();

      if (insertError) throw insertError;

      if (inserted) {
        setAssetsList((prev) => [mapRowToAsset(inserted, 0), ...prev]);
      }

      toast.dismiss(loadingToast);
      toast.success(
        `Imagen subida para ${formatLabel} (puedes usar IA Vision desde Editar etiquetas)`,
      );
    } catch (error: any) {
      console.error(error);
      toast.dismiss(loadingToast);
      toast.error(
        error?.message
          ? `Error al subir imagen: ${error.message}`
          : "No se pudo subir la imagen",
      );
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  const handleAnalyzeEditingAssetWithVision = async () => {
    if (!editingTags || !sucursalActiva) return;
    setIsAnalyzingVision(true);
    try {
      const { tags: detectedTags, source } = await analyzeAssetImageTags({
        imageUrl: editingTags.img,
        filename: editingTags.name,
        branchName: sucursalActiva.nombre,
        allowFilenameFallback: false,
      });
      const formatted = formatTagsString(detectedTags.join(", "));
      setEditingTags((prev) => (prev ? { ...prev, draft: formatted } : prev));
      if (source === "gemini") {
        toast.success("Etiquetas generadas con Gemini Vision (gemini-3.8-flash)");
      } else {
        toast.success("Etiquetas generadas por Webhook IA");
      }
    } catch (error: any) {
      console.error(error);
      toast.error(
        error?.message
          ? `Error al analizar con IA: ${error.message}`
          : "No se pudo analizar la imagen con IA",
      );
    } finally {
      setIsAnalyzingVision(false);
    }
  };

  const handleDeleteAsset = async (asset: Asset) => {
    setDeletingId(asset.id);

    if (!supabase) {
      setAssetsList((prev) => prev.filter((a) => a.id !== asset.id));
      setDeletingId(null);
      toast.success("Activo eliminado");
      return;
    }

    try {
      const { data: deletedRows, error: deleteDbError } = await supabase
        .from("activos")
        .delete()
        .eq("id", String(asset.id))
        .select();

      if (deleteDbError) {
        if (deleteDbError.code === "23503") {
          toast.error(
            "No se puede eliminar este activo porque ya está vinculado a una publicación.",
          );
          return;
        }
        throw deleteDbError;
      }

      if (!hasAffectedRows(deletedRows)) {
        toast.error(
          "Supabase bloqueó el borrado (0 filas afectadas). Activa la política RLS de DELETE para la tabla 'activos' en Supabase.",
        );
        return;
      }

      const storagePath = extractStoragePath(asset.img, "galeria");
      if (storagePath) {
        await supabase.storage.from("galeria").remove([storagePath]);
      }

      setAssetsList((prev) => {
        const next = prev.filter((a) => a.id !== asset.id);
        if (tag !== "Todos" && !next.some((a) => a.tags.includes(tag))) {
          setTag("Todos");
        }
        return next;
      });

      toast.success("Activo eliminado correctamente de Supabase");
    } catch (error: any) {
      console.error(error);
      toast.error(
        error?.message
          ? `Error al eliminar activo: ${error.message}`
          : "No se pudo eliminar el activo",
      );
    } finally {
      setDeletingId(null);
    }
  };

  const handleSaveTags = async () => {
    if (!editingTags) return;
    const normalized = formatTagsString(editingTags.draft);
    if (!normalized) {
      toast.error("Ingresa al menos una etiqueta para el activo");
      return;
    }

    const nextTags = parseTags(normalized);

    if (!supabase) {
      setAssetsList((prev) =>
        prev.map((a) =>
          a.id === editingTags.id
            ? { ...a, tags: nextTags, name: nextTags[0] ?? a.name }
            : a,
        ),
      );
      setEditingTags(null);
      toast.success("Etiquetas actualizadas");
      return;
    }

    try {
      const { data: updatedRows, error } = await supabase
        .from("activos")
        .update({ tags: normalized })
        .eq("id", String(editingTags.id))
        .select();

      if (error) throw error;

      if (!hasAffectedRows(updatedRows)) {
        toast.error(
          "Supabase bloqueó la actualización (0 filas afectadas). Activa la política RLS de UPDATE para la tabla 'activos' en Supabase.",
        );
        return;
      }

      setAssetsList((prev) =>
        prev.map((a) =>
          a.id === editingTags.id
            ? { ...a, tags: nextTags, name: nextTags[0] ?? a.name }
            : a,
        ),
      );
      setEditingTags(null);
      toast.success("Etiquetas actualizadas en Supabase");
    } catch (error: any) {
      console.error(error);
      toast.error(
        error?.message
          ? `Error al guardar etiquetas: ${error.message}`
          : "No se pudieron actualizar las etiquetas",
      );
    }
  };

  const copyToClipboard = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(successMessage);
    } catch (error) {
      console.error(error);
      toast.error("No se pudo copiar al portapapeles. Copia el texto manualmente.");
    }
  };

  const handleToggleBrandTag = async (asset: Asset, brandTag: BrandTag) => {
    if (!supabase) {
      toast.error("Configura Supabase para guardar las etiquetas de marca");
      return;
    }

    const nextTagsString = toggleBrandTag(asset.tags.join(", "), brandTag);
    const nextTags = parseTags(nextTagsString);
    const willBeActive = hasBrandTag(nextTags, brandTag);

    setTogglingBrandId(asset.id);
    setAssetsList((prev) =>
      prev.map((item) => (item.id === asset.id ? { ...item, tags: nextTags } : item)),
    );

    try {
      const { data, error } = await supabase
        .from("activos")
        .update({ tags: formatTagsString(nextTagsString) })
        .eq("id", asset.id)
        .select();

      if (error) throw error;
      if (!hasAffectedRows(data)) {
        throw new Error(
          "Supabase bloqueó la actualización (0 filas afectadas). Activa la política RLS de UPDATE para la tabla 'activos'.",
        );
      }

      toast.success(
        willBeActive
          ? `Activo marcado como ${brandTag === BRAND_LOGO_TAG ? "Logo" : "Referencia de Marca"}`
          : `Etiqueta ${brandTag === BRAND_LOGO_TAG ? "Logo" : "Referencia de Marca"} removida`,
      );
    } catch (error: any) {
      console.error(error);
      setAssetsList((prev) =>
        prev.map((item) => (item.id === asset.id ? { ...item, tags: asset.tags } : item)),
      );
      toast.error(
        error?.message
          ? `No se pudo actualizar la etiqueta de marca: ${error.message}`
          : "No se pudo actualizar la etiqueta de marca",
      );
    } finally {
      setTogglingBrandId(null);
    }
  };

  const handleGeneratePrompts = async () => {
    if (!sucursalActiva) return;

    setIsGeneratingPrompts(true);
    setPromptItems([]);

    try {
      const result = await generateWeeklyImagePromptsWithAI({
        branch: {
          nombre: sucursalActiva.nombre,
          tono: sucursalActiva.tono,
          reglas_negativas: sucursalActiva.reglas_negativas,
          brand_kit: sucursalActiva.brand_kit,
        },
        count: promptCount,
        aspectRatio: promptAspectRatio,
        campaignContext: promptCampaign,
        referenceImageUrls: brandReferenceAssets.map((asset) => asset.img),
      });

      setPromptItems(result.items);
      setPromptMeta({
        model: result.model,
        references: result.referenceImagesUsed,
        aspectRatio: result.aspectRatio,
      });
      toast.success(`${result.items.length} prompts visuales generados con IA`);
    } catch (error: any) {
      console.error(error);
      toast.error(
        error?.message
          ? `Error al generar prompts: ${error.message}`
          : "No se pudieron generar los prompts visuales",
      );
    } finally {
      setIsGeneratingPrompts(false);
    }
  };

  if (!sucursalActiva) {
    return (
      <AppShell
        title="Biblioteca de Activos"
        subtitle="Galería de imágenes etiquetadas automáticamente por IA"
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
                Por favor, selecciona una sucursal en Configuración para ver los activos
              </p>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  const allTags = ["Todos", ...Array.from(new Set(assetsList.flatMap((a) => a.tags)))];
  const list = tag === "Todos" ? assetsList : assetsList.filter((a) => a.tags.includes(tag));
  const unused = countUnused(assetsList);

  return (
    <AppShell
      title="Biblioteca de Activos"
      subtitle={`${sucursalActiva.nombre} · ${assetsList.length} imágenes etiquetadas automáticamente por IA`}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleFileUpload}
          />
          <Button
            variant="outline"
            size="lg"
            onClick={() => setIsPromptsDialogOpen(true)}
          >
            <Wand2 className="text-violet" />
            Generar Prompts con IA
          </Button>
          <Button
            variant="brand"
            size="lg"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {isUploading ? <Loader2 className="animate-spin" /> : <Plus />}
            {isUploading ? "Subiendo..." : "Subir Nuevos Activos"}
          </Button>
        </div>
      }
    >
      {isLowStock(assetsList) && (
        <Alert variant="warning" className="mb-5 rounded-xl">
          <TriangleAlert className="h-5 w-5" />
          <AlertTitle className="text-warning">
            {unused === 1
              ? "Solo queda 1 imagen sin usar en el banco"
              : `Solo quedan ${unused} imágenes sin usar en el banco`}
          </AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>
              Sube nuevos activos para que la IA no repita las mismas fotos en tus próximas publicaciones.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsPromptsDialogOpen(true)}
            >
              <Wand2 className="h-3.5 w-3.5 text-violet" />
              Generar Prompts con IA
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div className="mb-4 rounded-xl border bg-muted/40 px-3.5 py-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">Requisitos Meta API (REQ-2.1):</span>{" "}
        JPG, PNG o WEBP · Máx. 8 MB · Mín. 320×320 px · Proporción Feed (4:5 vertical, 1:1 cuadrado hasta 1.91:1 horizontal) o Stories (9:16).
      </div>
      <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1">
        {allTags.map((t) => (
          <button
            key={t}
            onClick={() => setTag(t)}
            className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition ${tag === t ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {list.map((a) => {
          const isDeleting = deletingId === a.id;
          return (
            <figure key={a.id} className="group overflow-hidden rounded-2xl border bg-card shadow-card">
              <div className="relative">
                <img
                  src={a.img}
                  alt={a.name}
                  loading="lazy"
                  width={816}
                  height={816}
                  className="aspect-square w-full object-cover transition duration-300 group-hover:scale-105"
                />
                <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-card/90 px-2 py-1 text-xs font-semibold backdrop-blur">
                  <Repeat className="h-3 w-3" />Veces usada: {a.uses}
                </span>
                <div className="absolute left-2 top-2 flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8 rounded-full bg-card/90 backdrop-blur"
                    title="Editar etiquetas"
                    onClick={() =>
                      setEditingTags({
                        id: a.id,
                        draft: a.tags.join(", "),
                        img: a.img,
                        name: a.name,
                      })
                    }
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    title="Eliminar activo"
                    disabled={isDeleting}
                    onClick={() => handleDeleteAsset(a)}
                  >
                    {isDeleting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
                {(hasBrandTag(a.tags, BRAND_LOGO_TAG) ||
                  hasBrandTag(a.tags, BRAND_REFERENCE_TAG)) && (
                  <div className="absolute bottom-2 left-2 flex flex-wrap gap-1">
                    {hasBrandTag(a.tags, BRAND_LOGO_TAG) && (
                      <Badge variant="scheduled" className="shadow">
                        Logo
                      </Badge>
                    )}
                    {hasBrandTag(a.tags, BRAND_REFERENCE_TAG) && (
                      <Badge variant="secondary" className="shadow">
                        Referencia
                      </Badge>
                    )}
                  </div>
                )}
              </div>
              <figcaption className="p-3">
                <p className="truncate text-sm font-semibold">{a.name}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {a.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-md bg-violet-soft px-2 py-0.5 text-xs font-medium text-violet"
                    >
                      {t}
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Button
                    type="button"
                    variant={hasBrandTag(a.tags, BRAND_LOGO_TAG) ? "default" : "outline"}
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    title="Marcar como logo de la marca"
                    disabled={togglingBrandId === a.id}
                    onClick={() => handleToggleBrandTag(a, BRAND_LOGO_TAG)}
                  >
                    <ImagePlus className="h-3 w-3" />
                    Logo
                  </Button>
                  <Button
                    type="button"
                    variant={hasBrandTag(a.tags, BRAND_REFERENCE_TAG) ? "default" : "outline"}
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    title="Marcar como referencia visual de la marca"
                    disabled={togglingBrandId === a.id}
                    onClick={() => handleToggleBrandTag(a, BRAND_REFERENCE_TAG)}
                  >
                    <Palette className="h-3 w-3" />
                    Referencia
                  </Button>
                </div>
              </figcaption>
            </figure>
          );
        })}
      </div>
      {list.length === 0 && (
        <p className="text-sm text-muted-foreground py-4">No hay activos disponibles para esta sucursal.</p>
      )}

      <Dialog open={editingTags !== null} onOpenChange={(open) => !open && setEditingTags(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar etiquetas del activo</DialogTitle>
            <DialogDescription>
              Separa las etiquetas con comas (ej. #producto, #ambiente, #oferta) para el algoritmo de cruce de la IA.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="asset-tags">Etiquetas visuales</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isAnalyzingVision}
                onClick={handleAnalyzeEditingAssetWithVision}
              >
                {isAnalyzingVision ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 text-violet" />
                )}
                {isAnalyzingVision ? "Analizando..." : "Sugerir con IA Vision"}
              </Button>
            </div>
            <Input
              id="asset-tags"
              value={editingTags?.draft ?? ""}
              onChange={(e) =>
                setEditingTags((prev) => (prev ? { ...prev, draft: e.target.value } : prev))
              }
              placeholder="#producto, #ambiente, #origen"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingTags(null)}>
              Cancelar
            </Button>
            <Button variant="brand" onClick={handleSaveTags}>
              Guardar etiquetas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isPromptsDialogOpen} onOpenChange={setIsPromptsDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-violet" />
              Generador Semanal de Prompts Visuales (IA)
            </DialogTitle>
            <DialogDescription>
              Gemini analiza el Brand Kit y hasta 2 imágenes de referencia para escribir prompts en
              inglés listos para ImageFX, Midjourney o DALL·E. Los prompts no gastan cuota de
              generación de imágenes.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border bg-muted/40 p-3">
                <p className="text-xs font-semibold text-foreground">Paleta del Brand Kit</p>
                {brandKitColors.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {brandKitColors.map((color) => (
                      <span
                        key={color.label}
                        className="inline-flex items-center gap-1.5 rounded-full bg-card px-2 py-0.5 text-[11px] font-medium"
                      >
                        <span
                          className="h-3 w-3 rounded-full border"
                          style={{ backgroundColor: color.value }}
                        />
                        {color.label} · {color.value}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Sin colores configurados. Añádelos en Configuración → Identidad Visual (Brand
                    Kit).
                  </p>
                )}
                {brandKit.visual_style && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Estilo: {brandKit.visual_style}
                  </p>
                )}
              </div>

              <div className="rounded-xl border bg-muted/40 p-3">
                <p className="text-xs font-semibold text-foreground">Imágenes de referencia</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {brandReferenceAssets.length > 0
                    ? `Se usarán ${brandReferenceAssets.length} ${
                        brandReferenceAssets.length === 1 ? "imagen" : "imágenes"
                      } marcadas como Logo / Referencia.`
                    : "Ninguna imagen marcada. Usa los botones Logo o Referencia en un activo para mejorar la coherencia visual."}
                </p>
                {brandReferenceAssets.length > 0 && (
                  <div className="mt-2 flex gap-2">
                    {brandReferenceAssets.map((asset) => (
                      <img
                        key={asset.id}
                        src={asset.img}
                        alt={asset.name}
                        className="h-12 w-12 rounded-md border object-cover"
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Cantidad de piezas</Label>
              <div className="flex flex-wrap gap-2">
                {WEEKLY_PROMPT_COUNT_OPTIONS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    aria-pressed={promptCount === count}
                    disabled={isGeneratingPrompts}
                    onClick={() => {
                      setPromptCount(count);
                      setPromptItems([]);
                    }}
                    className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                      promptCount === count
                        ? "border-primary bg-primary-soft text-primary"
                        : "bg-card hover:bg-muted"
                    }`}
                  >
                    {count}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Mezcla de pilares del lote:</p>
              <div className="flex flex-wrap gap-2">
                {summarizeWeeklyBatchPlan(
                  calculateWeeklyBatchPlan({
                    count: promptCount,
                    aspectRatio: promptAspectRatio,
                  }),
                ).map((item) => (
                  <span
                    key={item.pillar}
                    className="rounded-full border bg-card px-3 py-1 text-xs font-medium"
                  >
                    {item.label} · {item.count} de {promptCount} ({item.sharePercent}%)
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Proporción</Label>
              <div className="flex flex-wrap gap-2">
                {WEEKLY_IMAGE_ASPECT_RATIOS.map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    aria-pressed={promptAspectRatio === ratio}
                    disabled={isGeneratingPrompts}
                    onClick={() => {
                      setPromptAspectRatio(ratio);
                      setPromptItems([]);
                    }}
                    className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                      promptAspectRatio === ratio
                        ? "border-primary bg-primary-soft text-primary"
                        : "bg-card hover:bg-muted"
                    }`}
                  >
                    {WEEKLY_IMAGE_ASPECT_RATIO_LABELS[ratio]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="weekly-prompts-campaign">Tema o campaña (opcional)</Label>
              <Textarea
                id="weekly-prompts-campaign"
                rows={2}
                value={promptCampaign}
                disabled={isGeneratingPrompts}
                onChange={(e) => setPromptCampaign(e.target.value)}
                placeholder="Ej. Lanzamiento de temporada, promoción de fin de mes..."
              />
            </div>

            {promptMeta && (
              <p className="text-xs text-muted-foreground">
                Generado con {promptMeta.model} · Formato{" "}
                {WEEKLY_IMAGE_ASPECT_RATIO_LABELS[promptMeta.aspectRatio]} ·{" "}
                {promptMeta.references}{" "}
                {promptMeta.references === 1 ? "referencia usada" : "referencias usadas"}.
              </p>
            )}

            {promptItems.length > 0 && (
              <div className="space-y-3">
                {promptItems.map((item, index) => (
                  <div
                    key={`${item.pillar}-${index}`}
                    className="space-y-2 rounded-xl border bg-card p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge variant="secondary">{item.pillarLabel}</Badge>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          copyToClipboard(item.prompt_ingles, "Prompt en inglés copiado")
                        }
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copiar Prompt (EN)
                      </Button>
                    </div>
                    <p className="text-sm text-foreground">{item.idea_espanol}</p>
                    <pre className="max-h-44 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted p-3 font-mono text-xs text-foreground">
                      {item.prompt_ingles}
                    </pre>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-1">
                        {item.suggested_tags.map((suggestedTag) => (
                          <span
                            key={suggestedTag}
                            className="rounded bg-violet-soft px-1.5 py-0.5 text-[10px] font-medium text-violet"
                          >
                            #{suggestedTag}
                          </span>
                        ))}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          copyToClipboard(item.suggested_tags.join(", "), "Etiquetas copiadas")
                        }
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copiar Tags
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              disabled={isGeneratingPrompts}
              onClick={() => setIsPromptsDialogOpen(false)}
            >
              Cerrar
            </Button>
            <Button
              variant="brand"
              disabled={isGeneratingPrompts}
              onClick={handleGeneratePrompts}
            >
              {isGeneratingPrompts ? <Loader2 className="animate-spin" /> : <Wand2 />}
              {isGeneratingPrompts
                ? "Generando prompts..."
                : promptItems.length > 0
                  ? "Regenerar prompts"
                  : "Generar prompts"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
