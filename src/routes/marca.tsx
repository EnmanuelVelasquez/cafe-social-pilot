import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Save, Ban } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { setPillarValue, type Pillar } from "@/lib/brand";
import { useBranchStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import type { Sucursal } from "@/types";

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
  const { sucursales, sucursalActiva, setSucursales, setSucursalActiva } = useBranchStore();

  const [name, setName] = useState("Café Don Juan");
  const [tone, setTone] = useState("Cercano");
  const [pillars, setPillars] = useState<Pillar[]>([
    { name: "Educativo", value: 40 },
    { name: "Venta", value: 30 },
    { name: "Estilo de vida", value: 30 },
  ]);
  const [rules, setRules] = useState("Nunca mencionar a la competencia. No usar las palabras \"barato\" ni \"instantáneo\". No hacer promesas de salud.");
  const total = pillars.reduce((a, p) => a + p.value, 0);

  useEffect(() => {
    const fetchSucursales = async () => {
      if (!supabase) return;
      const { data, error } = await supabase.from("sucursales").select("*");
      if (error) {
        console.error(error);
        toast.error("Error al cargar las sucursales");
        return;
      }
      if (data) {
        const lista = data as Sucursal[];
        setSucursales(lista);
        if (lista.length > 0 && !sucursalActiva && lista[0]) {
          setSucursalActiva(lista[0]);
        }
      }
    };

    fetchSucursales();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (sucursalActiva) {
      setName(sucursalActiva.nombre ?? "");
      setTone(sucursalActiva.tono ?? "Cercano");
      setRules(sucursalActiva.reglas_negativas ?? "");
    }
  }, [sucursalActiva]);

  const save = async () => {
    const cleanName = (name ?? "").trim();
    const cleanRules = (rules ?? "").trim();

    if (!cleanName) { toast.error("El nombre de la sucursal es obligatorio"); return; }
    if (!cleanRules) { toast.error("Las Reglas Negativas son obligatorias"); return; }
    if (total !== 100) { toast.error(`Los pilares deben sumar 100% (actual: ${total}%)`); return; }
    if (!supabase) {
      if (sucursalActiva) {
        const updated: Sucursal = {
          ...sucursalActiva,
          nombre: cleanName,
          tono: tone || "Cercano",
          reglas_negativas: cleanRules,
        };
        setSucursalActiva(updated);
        setSucursales(sucursales.map((s) => (s.id === updated.id ? updated : s)));
      }
      toast.success("Parámetros de marca guardados");
      return;
    }

    try {
      if (sucursalActiva) {
        const { data, error } = await supabase
          .from("sucursales")
          .update({ nombre: cleanName, tono: tone || "Cercano", reglas_negativas: cleanRules })
          .eq("id", sucursalActiva.id)
          .select();

        if (error) throw error;
        if (!data || data.length === 0) {
          toast.error("No se pudo actualizar la sucursal en Supabase. Verifica las políticas RLS (UPDATE) de la tabla 'sucursales'.");
          return;
        }

        const updated = data[0] as Sucursal;
        setSucursalActiva(updated);
        setSucursales(sucursales.map((s) => (s.id === updated.id ? updated : s)));
      } else {
        const { data, error } = await supabase
          .from("sucursales")
          .insert([{ nombre: cleanName, tono: tone || "Cercano", reglas_negativas: cleanRules }])
          .select()
          .single();

        if (error) throw error;
        if (data) {
          const created = data as Sucursal;
          setSucursales([...sucursales, created]);
          setSucursalActiva(created);
        }
      }

      toast.success("Parámetros de marca guardados en Supabase");
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message ? `Error al guardar: ${error.message}` : "Error al guardar los parámetros en la base de datos");
    }
  };

  return (
    <AppShell title="Configuración de Marca" subtitle="Brand Engine · Enseña a la IA cómo habla tu marca">
      <div className="space-y-5">
        <section className="grid gap-5 rounded-2xl border bg-card p-5 shadow-card md:grid-cols-2 md:p-6">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="branch-select">Sucursal Activa</Label>
            <Select
              value={sucursalActiva?.id ?? ""}
              onValueChange={(id) => {
                const selected = sucursales.find((s) => s.id === id) ?? null;
                setSucursalActiva(selected);
              }}
            >
              <SelectTrigger id="branch-select">
                <SelectValue placeholder="Selecciona una sucursal" />
              </SelectTrigger>
              <SelectContent>
                {sucursales.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
