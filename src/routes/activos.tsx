import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Repeat, Store, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { assets as sampleAssets, countUnused, isLowStock, type Asset } from "@/lib/data";
import { useBranchStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/activos")({
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

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t).trim()).filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function Activos() {
  const { sucursalActiva } = useBranchStore();
  const [assetsList, setAssetsList] = useState<Asset[]>([]);
  const [tag, setTag] = useState("Todos");

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
        .eq("sucursal_id", sucursalActiva.id);

      if (error) {
        console.error(error);
        toast.error("Error cargando los activos de la sucursal");
        return;
      }

      if (data) {
        const mapped: Asset[] = data.map((d: any, index: number) => {
          const parsedTags = parseTags(d.tags);
          return {
            id: d.id ?? index + 1,
            img: d.url_imagen || "",
            name: d.nombre || parsedTags[0] || `Activo ${index + 1}`,
            tags: parsedTags,
            uses: typeof d.usos === "number" ? d.usos : typeof d.uses === "number" ? d.uses : 0,
          };
        });
        setAssetsList(mapped);
      }
    };

    fetchActivos();
  }, [sucursalActiva?.id]);

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
      action={<Button variant="brand" size="lg" onClick={() => toast("Selector de archivos próximamente")}><Plus /> Subir Nuevos Activos</Button>}
    >
      {isLowStock(assetsList) && (
        <Alert variant="warning" className="mb-5 rounded-xl">
          <TriangleAlert className="h-5 w-5" />
          <AlertTitle className="text-warning">
            {unused === 1
              ? "Solo queda 1 imagen sin usar en el banco"
              : `Solo quedan ${unused} imágenes sin usar en el banco`}
          </AlertTitle>
          <AlertDescription>
            Sube nuevos activos para que la IA no repita las mismas fotos en tus próximas publicaciones.
          </AlertDescription>
        </Alert>
      )}
      <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1">
        {allTags.map((t) => (
          <button key={t} onClick={() => setTag(t)} className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition ${tag === t ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>{t}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {list.map((a) => (
          <figure key={a.id} className="group overflow-hidden rounded-2xl border bg-card shadow-card">
            <div className="relative">
              <img src={a.img} alt={a.name} loading="lazy" width={816} height={816} className="aspect-square w-full object-cover transition duration-300 group-hover:scale-105" />
              <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-card/90 px-2 py-1 text-xs font-semibold backdrop-blur"><Repeat className="h-3 w-3" />Veces usada: {a.uses}</span>
            </div>
            <figcaption className="p-3">
              <p className="truncate text-sm font-semibold">{a.name}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {a.tags.map((t) => <span key={t} className="rounded-md bg-violet-soft px-2 py-0.5 text-xs font-medium text-violet">{t}</span>)}
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
      {list.length === 0 && (
        <p className="text-sm text-muted-foreground py-4">No hay activos disponibles para esta sucursal.</p>
      )}
    </AppShell>
  );
}
