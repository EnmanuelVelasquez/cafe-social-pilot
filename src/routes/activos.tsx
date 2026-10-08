import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Repeat } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { assets } from "@/lib/data";

export const Route = createFileRoute("/activos")({
  head: () => ({
    meta: [
      { title: "Biblioteca de Activos — AutoSocial AI" },
      { name: "description", content: "Galería de imágenes con etiquetas automáticas y contador de uso." },
      { property: "og:title", content: "Biblioteca de Activos — AutoSocial AI" },
      { property: "og:description", content: "Galería de imágenes con etiquetas automáticas y contador de uso." },
    ],
  }),
  component: Activos,
});

const allTags = ["Todos", ...Array.from(new Set(assets.flatMap((a) => a.tags)))];

function Activos() {
  const [tag, setTag] = useState("Todos");
  const list = tag === "Todos" ? assets : assets.filter((a) => a.tags.includes(tag));
  return (
    <AppShell
      title="Biblioteca de Activos"
      subtitle={`${assets.length} imágenes etiquetadas automáticamente por IA`}
      action={<Button variant="brand" size="lg" onClick={() => toast("Selector de archivos próximamente")}><Plus /> Subir Nuevos Activos</Button>}
    >
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
    </AppShell>
  );
}
