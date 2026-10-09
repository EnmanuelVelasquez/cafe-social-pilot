import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Save, Ban } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { setPillarValue, type Pillar } from "@/lib/brand";

export const Route = createFileRoute("/marca")({
  head: () => ({
    meta: [
      { title: "Brand Engine — AutoSocial AI" },
      { name: "description", content: "Define tono de voz, pilares de contenido y reglas negativas para tu marca." },
      { property: "og:title", content: "Brand Engine — AutoSocial AI" },
      { property: "og:description", content: "Define tono de voz, pilares de contenido y reglas negativas para tu marca." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Marca,
});

const tones = ["Cercano", "Profesional", "Divertido", "Inspirador"];

function Marca() {
  const [name, setName] = useState("Café Don Juan");
  const [tone, setTone] = useState("Cercano");
  const [pillars, setPillars] = useState<Pillar[]>([
    { name: "Educativo", value: 40 },
    { name: "Venta", value: 30 },
    { name: "Estilo de vida", value: 30 },
  ]);
  const [rules, setRules] = useState("Nunca mencionar a la competencia. No usar las palabras \"barato\" ni \"instantáneo\". No hacer promesas de salud.");
  const total = pillars.reduce((a, p) => a + p.value, 0);

  const save = () => {
    if (!rules.trim()) { toast.error("Las Reglas Negativas son obligatorias"); return; }
    if (total !== 100) { toast.error(`Los pilares deben sumar 100% (actual: ${total}%)`); return; }
    toast.success("Parámetros de marca guardados");
  };

  return (
    <AppShell title="Configuración de Marca" subtitle="Brand Engine · Enseña a la IA cómo habla tu marca">
      <div className="space-y-5">
        <section className="grid gap-5 rounded-2xl border bg-card p-5 shadow-card md:grid-cols-2 md:p-6">
          <div className="space-y-2">
            <Label htmlFor="name">Nombre de la empresa</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Tono de voz</Label>
            <div className="flex flex-wrap gap-2">
              {tones.map((t) => (
                <button key={t} type="button" onClick={() => setTone(t)} className={`rounded-full border px-4 py-2 text-sm font-medium transition ${tone === t ? "border-primary bg-primary-soft text-primary" : "hover:bg-muted"}`}>{t}</button>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-5 shadow-card md:p-6">
          <div className="mb-5 flex items-center justify-between gap-4">
            <h2 className="font-display font-semibold">Pilares de contenido</h2>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${total === 100 ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>Total: {total}%</span>
          </div>
          <div className="space-y-6">
            {pillars.map((p, i) => (
              <div key={p.name}>
                <div className="mb-2 flex justify-between text-sm"><span className="font-medium">{p.name}</span><span className="font-semibold text-primary">{p.value}%</span></div>
                <Slider value={[p.value]} max={100} step={5} onValueChange={([v = 0]) => setPillars((ps) => setPillarValue(ps, i, v))} />
              </div>
            ))}
          </div>
          <div className="mt-6 flex h-3 overflow-hidden rounded-full bg-muted">
            {pillars.map((p, i) => (
              <div key={p.name} style={{ width: `${(p.value / Math.max(total, 100)) * 100}%` }} className={["bg-primary", "bg-violet", "bg-success"][i]} />
            ))}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-5 shadow-card md:p-6">
          <Label htmlFor="rules" className="flex items-center gap-2"><Ban className="h-4 w-4 text-destructive" />Reglas Negativas / Palabras Prohibidas <span className="text-destructive">*</span></Label>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">Lo que la IA jamás debe decir en tus publicaciones.</p>
          <Textarea id="rules" required rows={4} value={rules} onChange={(e) => setRules(e.target.value)} />
        </section>

        <Button variant="cta" size="lg" className="h-14 w-full text-base" onClick={save}><Save /> Guardar Parámetros de Marca</Button>
      </div>
    </AppShell>
  );
}
