import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Save, Plug, Instagram, Facebook } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useBranchStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import type { Sucursal } from "@/types";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Configuración de Espacio — AutoSocial AI" },
      { name: "description", content: "Gestiona sucursales e integraciones de redes sociales de tu espacio." },
      { property: "og:title", content: "Configuración de Espacio — AutoSocial AI" },
      { property: "og:description", content: "Gestiona sucursales e integraciones de redes sociales de tu espacio." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Settings,
});

const integrations = [
  { name: "Meta Graph API (Instagram/Facebook)", desc: "Publica automáticamente en tu cuenta de Instagram Business y tu página de Facebook.", icons: [Instagram, Facebook] },
];

function Settings() {
  const { sucursales, sucursalActiva, setSucursales, setSucursalActiva } = useBranchStore();

  const [name, setName] = useState("");
  const [tone, setTone] = useState("");
  const [rules, setRules] = useState("");

  useEffect(() => {
    const fetchSucursales = async () => {
      if (!supabase) return;
      const { data, error } = await supabase.from("sucursales").select("*");
      if (error) {
        console.error(error);
        toast.error("Error al cargar las sucursales desde Supabase");
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
      setTone(sucursalActiva.tono ?? "");
      setRules(sucursalActiva.reglas_negativas ?? "");
    }
  }, [sucursalActiva]);

  const handleSaveBranch = async () => {
    const cleanName = (name ?? "").trim();
    const cleanTone = (tone ?? "").trim();
    const cleanRules = (rules ?? "").trim();

    if (!cleanName) {
      toast.error("El nombre de la sucursal es obligatorio");
      return;
    }
    if (!cleanRules) {
      toast.error("Las Reglas Negativas son obligatorias");
      return;
    }
    if (!sucursalActiva) {
      toast.error("Selecciona o crea una sucursal primero");
      return;
    }
    if (!supabase) {
      const updated: Sucursal = {
        ...sucursalActiva,
        nombre: cleanName,
        tono: cleanTone || "Cercano",
        reglas_negativas: cleanRules,
      };
      setSucursalActiva(updated);
      setSucursales(sucursales.map((s) => (s.id === updated.id ? updated : s)));
      toast.success("Cambios de sucursal guardados");
      return;
    }

    try {
      const { data, error } = await supabase
        .from("sucursales")
        .update({
          nombre: cleanName,
          tono: cleanTone || "Cercano",
          reglas_negativas: cleanRules,
        })
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
      toast.success("Cambios de sucursal guardados en Supabase");
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message ? `Error al guardar: ${error.message}` : "Error al guardar los cambios en Supabase");
    }
  };

  const handleCreateBranch = async () => {
    if (!supabase) {
      const created: Sucursal = {
        id: `sucursal-${Date.now()}`,
        perfil_id: sucursalActiva?.perfil_id ?? "perfil-1",
        nombre: `Nueva Sucursal ${sucursales.length + 1}`,
        tono: "Cercano",
        reglas_negativas: "Nunca mencionar a la competencia.",
      };
      setSucursales([...sucursales, created]);
      setSucursalActiva(created);
      toast.success("Nueva sucursal creada");
      return;
    }

    try {
      let perfilId = sucursalActiva?.perfil_id ?? sucursales[0]?.perfil_id;
      if (!perfilId) {
        const { data: perfiles } = await supabase.from("perfiles").select("id").limit(1);
        perfilId = perfiles?.[0]?.id;
      }

      const payload: Record<string, unknown> = {
        nombre: `Nueva Sucursal ${sucursales.length + 1}`,
        tono: "Cercano",
        reglas_negativas: "Nunca mencionar a la competencia.",
      };
      if (perfilId) {
        payload["perfil_id"] = perfilId;
      }

      const { data, error } = await supabase
        .from("sucursales")
        .insert([payload])
        .select()
        .single();

      if (error) throw error;
      if (data) {
        const created = data as Sucursal;
        setSucursales([...sucursales, created]);
        setSucursalActiva(created);
        toast.success("Nueva sucursal creada en Supabase");
      }
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message ? `Error al crear sucursal: ${error.message}` : "No se pudo crear la nueva sucursal");
    }
  };

  return (
    <AppShell title="Configuración de Espacio" subtitle="Administra tus sucursales y conexiones con redes sociales">
      <Tabs defaultValue="sucursales" className="space-y-5">
        <TabsList>
          <TabsTrigger value="sucursales">Sucursales</TabsTrigger>
          <TabsTrigger value="integraciones">Integraciones</TabsTrigger>
        </TabsList>

        <TabsContent value="sucursales" className="space-y-5">
          <div className="grid gap-3 sm:flex sm:items-end sm:justify-between">
            <div className="space-y-2 sm:w-72">
              <Label>Sucursal Activa</Label>
              <Select
                value={sucursalActiva?.id ?? ""}
                onValueChange={(id) => {
                  const selected = sucursales.find((b) => b.id === id) ?? null;
                  setSucursalActiva(selected);
                }}
              >
                <SelectTrigger><SelectValue placeholder="Selecciona una sucursal" /></SelectTrigger>
                <SelectContent>
                  {sucursales.map((b) => <SelectItem key={b.id} value={b.id}>{b.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={handleCreateBranch}><Plus /> Añadir nueva sucursal</Button>
          </div>

          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="font-display">Editar sucursal</CardTitle>
              <CardDescription>Ajusta cómo la IA habla en nombre de esta sede.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="branch-name">Nombre de la Sucursal</Label>
                <Input
                  id="branch-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej. Sede Centro"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch-tone">Tono de Voz</Label>
                <Textarea
                  id="branch-tone"
                  rows={3}
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  placeholder="Ej. Cercano y cálido, como un barista que conoce a sus clientes por su nombre."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch-rules">Reglas Negativas (Negative Prompts)</Label>
                <Textarea
                  id="branch-rules"
                  rows={3}
                  value={rules}
                  onChange={(e) => setRules(e.target.value)}
                  placeholder={'Nunca mencionar a la competencia. No usar "barato" ni "instantáneo".'}
                />
              </div>
            </CardContent>
            <CardFooter className="justify-end">
              <Button variant="cta" onClick={handleSaveBranch}><Save /> Guardar Cambios</Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="integraciones" className="grid gap-4 md:grid-cols-2">
          {integrations.map((it) => (
            <Card key={it.name} className="shadow-card">
              <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                <div className="flex gap-1.5">
                  {it.icons.map((I, i) => (
                    <div key={i} className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary"><I className="h-5 w-5" /></div>
                  ))}
                </div>
                <Badge variant="secondary">Desconectado</Badge>
              </CardHeader>
              <CardContent className="space-y-1">
                <CardTitle className="font-display text-base">{it.name}</CardTitle>
                <CardDescription>{it.desc}</CardDescription>
              </CardContent>
              <CardFooter>
                <Button variant="cta" className="w-full"><Plug /> Conectar Cuenta</Button>
              </CardFooter>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
