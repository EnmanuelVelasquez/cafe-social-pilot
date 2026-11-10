import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Save, Plug, Instagram, Facebook, CheckCircle2, Trash2, Loader2, TriangleAlert, Palette } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { normalizeBrandKit } from "@/lib/brand";
import { extractStoragePath, hasAffectedRows, isMissingBrandKitColumnError } from "@/lib/data";
import { useBranchStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import type { BrandKit, IntegracionSocial, Sucursal } from "@/types";

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
  {
    platform: "Instagram_Graph_API",
    name: "Meta Graph API (Instagram/Facebook)",
    desc: "Publica automáticamente en tu cuenta de Instagram Business y tu página de Facebook.",
    icons: [Instagram, Facebook],
  },
];

const BRAND_COLOR_FIELDS = [
  { key: "primary_color", label: "Color primario" },
  { key: "secondary_color", label: "Color secundario" },
  { key: "accent_color", label: "Color de acento" },
] as const;

function Settings() {
  const { sucursales, sucursalActiva, setSucursales, setSucursalActiva, removeSucursal } = useBranchStore();

  const [name, setName] = useState("");
  const [tone, setTone] = useState("");
  const [rules, setRules] = useState("");
  const [brandKit, setBrandKit] = useState<BrandKit>({});
  const [branchIntegrations, setBranchIntegrations] = useState<IntegracionSocial[]>([]);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [isDeletingBranch, setIsDeletingBranch] = useState(false);

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
      setBrandKit(normalizeBrandKit(sucursalActiva.brand_kit));
    } else {
      setName("");
      setTone("");
      setRules("");
      setBrandKit({});
    }
  }, [sucursalActiva]);

  useEffect(() => {
    if (!sucursalActiva || !supabase) {
      setBranchIntegrations([]);
      return;
    }

    supabase
      .from("integraciones_sociales")
      .select("*")
      .eq("sucursal_id", sucursalActiva.id)
      .then(({ data, error }) => {
        if (!error && data) {
          setBranchIntegrations(data as IntegracionSocial[]);
        }
      });
  }, [sucursalActiva?.id]);

  const handleToggleIntegration = async (platform: string) => {
    if (!sucursalActiva) {
      toast.error("Selecciona una sucursal primero");
      return;
    }

    const existing = branchIntegrations.find((i) => i.plataforma === platform);
    const hasRealToken =
      Boolean(existing?.token_cifrado) &&
      !String(existing?.token_cifrado).startsWith("token_");

    if (supabase && existing && (hasRealToken || existing.token_cifrado)) {
      try {
        const { data, error } = await supabase
          .from("integraciones_sociales")
          .update({ token_cifrado: null })
          .eq("id", existing.id)
          .select()
          .single();

        if (!error && data) {
          setBranchIntegrations((prev) =>
            prev.map((item) => (item.id === existing.id ? (data as IntegracionSocial) : item)),
          );
        }
        if (hasRealToken) {
          toast.success("Cuenta desconectada");
          return;
        }
      } catch (error) {
        console.error(error);
      }
    }

    toast.info(
      "La integración directa con Meta Graph API (OAuth de Instagram Business y Facebook Pages) aún no está conectada. Usa por ahora la publicación manual (Copiar Copy y Descargar Imagen) en el Dashboard.",
    );
  };

  const updateBrandColor = (
    key: (typeof BRAND_COLOR_FIELDS)[number]["key"],
    value: string,
  ) => {
    setBrandKit((prev) => ({
      ...prev,
      [key]: value.trim() ? value.toUpperCase() : undefined,
    }));
  };

  const handleSaveBranch = async () => {
    const cleanName = (name ?? "").trim();
    const cleanTone = (tone ?? "").trim();
    const cleanRules = (rules ?? "").trim();
    const cleanBrandKit = normalizeBrandKit(brandKit);

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

    const hasInvalidColor = BRAND_COLOR_FIELDS.some(({ key }) => {
      const raw = (brandKit[key] ?? "").trim();
      return raw.length > 0 && !cleanBrandKit[key];
    });
    if (hasInvalidColor) {
      toast.error("Los colores del Brand Kit deben tener formato hexadecimal (#RGB o #RRGGBB)");
      return;
    }

    if (!supabase) {
      const updated: Sucursal = {
        ...sucursalActiva,
        nombre: cleanName,
        tono: cleanTone || "Cercano",
        reglas_negativas: cleanRules,
        brand_kit: cleanBrandKit,
      };
      setSucursalActiva(updated);
      setSucursales(sucursales.map((s) => (s.id === updated.id ? updated : s)));
      toast.success("Cambios de sucursal guardados");
      return;
    }

    try {
      const basePayload = {
        nombre: cleanName,
        tono: cleanTone || "Cercano",
        reglas_negativas: cleanRules,
      };

      let response = await supabase
        .from("sucursales")
        .update({ ...basePayload, brand_kit: cleanBrandKit })
        .eq("id", sucursalActiva.id)
        .select();

      let brandKitPersisted = true;

      // Fallback: si la columna `brand_kit` aún no existe en el proyecto remoto,
      // se guarda el resto de la sucursal y se conserva el Brand Kit en el store local.
      if (response.error && isMissingBrandKitColumnError(response.error)) {
        brandKitPersisted = false;
        response = await supabase
          .from("sucursales")
          .update(basePayload)
          .eq("id", sucursalActiva.id)
          .select();
      }

      if (response.error) throw response.error;
      if (!response.data || response.data.length === 0) {
        toast.error(
          "No se pudo actualizar la sucursal en Supabase. Verifica las políticas RLS (UPDATE) de la tabla 'sucursales'.",
        );
        return;
      }

      const updated: Sucursal = {
        ...(response.data[0] as Sucursal),
        brand_kit: cleanBrandKit,
      };
      setSucursalActiva(updated);
      setSucursales(sucursales.map((s) => (s.id === updated.id ? updated : s)));

      if (brandKitPersisted) {
        toast.success("Cambios de sucursal guardados en Supabase");
      } else {
        toast.warning(
          "Se guardó la sucursal, pero el Brand Kit no se persistió: falta la columna 'brand_kit'. Ejecuta el ALTER TABLE en Supabase.",
        );
      }
    } catch (error: any) {
      console.error(error);
      toast.error(
        error?.message ? `Error al guardar: ${error.message}` : "Error al guardar los cambios en Supabase",
      );
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
      toast.error(
        error?.message ? `Error al crear sucursal: ${error.message}` : "No se pudo crear la nueva sucursal",
      );
    }
  };

  const handleDeleteBranch = async () => {
    if (!sucursalActiva) return;
    const branchToDelete = sucursalActiva;
    setIsDeletingBranch(true);

    if (!supabase) {
      removeSucursal(branchToDelete.id);
      setIsDeletingBranch(false);
      setConfirmDeleteOpen(false);
      toast.success(`Sucursal "${branchToDelete.nombre}" eliminada`);
      return;
    }

    try {
      const { data: branchAssets } = await supabase
        .from("activos")
        .select("id, url_imagen")
        .eq("sucursal_id", branchToDelete.id);

      await supabase.from("publicaciones").delete().eq("sucursal_id", branchToDelete.id);
      await supabase.from("integraciones_sociales").delete().eq("sucursal_id", branchToDelete.id);
      await supabase.from("activos").delete().eq("sucursal_id", branchToDelete.id);

      const { data: deletedRows, error: deleteError } = await supabase
        .from("sucursales")
        .delete()
        .eq("id", branchToDelete.id)
        .select();

      if (deleteError) {
        if (deleteError.code === "23503") {
          toast.error(
            "No se pudo eliminar la sucursal porque aún tiene registros vinculados en Supabase.",
          );
          return;
        }
        throw deleteError;
      }

      if (!hasAffectedRows(deletedRows)) {
        toast.error(
          "Supabase bloqueó el borrado (0 filas afectadas). Activa la política RLS de DELETE para la tabla 'sucursales' en Supabase.",
        );
        return;
      }

      if (branchAssets && branchAssets.length > 0) {
        const storagePaths = branchAssets
          .map((a: any) => extractStoragePath(a.url_imagen || "", "galeria"))
          .filter((p): p is string => Boolean(p));
        if (storagePaths.length > 0) {
          await supabase.storage.from("galeria").remove(storagePaths);
        }
      }

      removeSucursal(branchToDelete.id);
      setConfirmDeleteOpen(false);
      toast.success(`Sucursal "${branchToDelete.nombre}" eliminada correctamente`);
    } catch (error: any) {
      console.error(error);
      toast.error(
        error?.message
          ? `Error al eliminar sucursal: ${error.message}`
          : "No se pudo eliminar la sucursal",
      );
    } finally {
      setIsDeletingBranch(false);
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
                  disabled={!sucursalActiva}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch-tone">Tono de Voz</Label>
                <Textarea
                  id="branch-tone"
                  rows={3}
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  placeholder="Ej. Cercano y cálido, profesional o corporativo según la identidad de la sede."
                  disabled={!sucursalActiva}
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
                  disabled={!sucursalActiva}
                />
              </div>

              <div className="space-y-4 rounded-xl border bg-muted/40 p-4">
                <div className="flex items-center gap-2">
                  <Palette className="h-4 w-4 text-violet" />
                  <p className="text-sm font-semibold text-foreground">Identidad Visual (Brand Kit)</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  La IA usa estos datos para describir la paleta, el estilo y el espacio del logo en
                  los prompts visuales. Todo es opcional.
                </p>

                <div className="grid gap-3 sm:grid-cols-3">
                  {BRAND_COLOR_FIELDS.map(({ key, label }) => (
                    <div key={key} className="space-y-2">
                      <Label htmlFor={`brand-${key}`}>{label}</Label>
                      <div className="flex items-center gap-2">
                        <input
                          id={`brand-${key}`}
                          type="color"
                          aria-label={label}
                          value={brandKit[key] ?? "#FFFFFF"}
                          onChange={(e) => updateBrandColor(key, e.target.value)}
                          disabled={!sucursalActiva}
                          className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-card p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <Input
                          value={brandKit[key] ?? ""}
                          onChange={(e) => updateBrandColor(key, e.target.value)}
                          placeholder="#RRGGBB"
                          disabled={!sucursalActiva}
                          className="font-mono text-xs"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="brand-visual-style">Estilo visual</Label>
                  <Textarea
                    id="brand-visual-style"
                    rows={2}
                    value={brandKit.visual_style ?? ""}
                    onChange={(e) =>
                      setBrandKit((prev) => ({
                        ...prev,
                        visual_style: e.target.value.trim() ? e.target.value : undefined,
                      }))
                    }
                    placeholder="Ej. Minimalista moderno, iluminación cálida, estilo editorial."
                    disabled={!sucursalActiva}
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <Label htmlFor="brand-reserve-logo">Reservar espacio para el logo</Label>
                    <p className="text-xs text-muted-foreground">
                      Añade una zona limpia en la composición para superponer el logo después.
                    </p>
                  </div>
                  <Switch
                    id="brand-reserve-logo"
                    checked={brandKit.reserve_logo_space ?? false}
                    onCheckedChange={(checked) =>
                      setBrandKit((prev) => ({ ...prev, reserve_logo_space: checked }))
                    }
                    disabled={!sucursalActiva}
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex flex-wrap items-center justify-between gap-3">
              <Button
                type="button"
                variant="destructive"
                disabled={!sucursalActiva || isDeletingBranch}
                onClick={() => setConfirmDeleteOpen(true)}
              >
                <Trash2 /> Eliminar Sucursal
              </Button>
              <Button variant="cta" disabled={!sucursalActiva} onClick={handleSaveBranch}>
                <Save /> Guardar Cambios
              </Button>
            </CardFooter>
          </Card>

          <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <TriangleAlert className="h-5 w-5 text-destructive" />
                  ¿Estás seguro de eliminar esta sucursal?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Vas a eliminar permanentemente la sucursal{" "}
                  <strong className="text-foreground">"{sucursalActiva?.nombre}"</strong> junto con
                  sus publicaciones, activos e integraciones vinculadas. Esta acción no se puede
                  deshacer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeletingBranch}>Cancelar</AlertDialogCancel>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isDeletingBranch}
                  onClick={handleDeleteBranch}
                >
                  {isDeletingBranch ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  {isDeletingBranch ? "Eliminando..." : "Sí, eliminar sucursal"}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TabsContent>

        <TabsContent value="integraciones" className="grid gap-4 md:grid-cols-2">
          {integrations.map((it) => {
            const record = branchIntegrations.find((b) => b.plataforma === it.platform);
            const isConnected =
              Boolean(record?.token_cifrado) &&
              !String(record?.token_cifrado).startsWith("token_");
            return (
              <Card key={it.name} className="shadow-card">
                <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                  <div className="flex gap-1.5">
                    {it.icons.map((I, i) => (
                      <div key={i} className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary"><I className="h-5 w-5" /></div>
                    ))}
                  </div>
                  <Badge variant={isConnected ? "scheduled" : "secondary"}>
                    {isConnected ? "Conectado" : "Desconectado"}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-1">
                  <CardTitle className="font-display text-base">{it.name}</CardTitle>
                  <CardDescription>{it.desc}</CardDescription>
                </CardContent>
                <CardFooter>
                  <Button
                    variant={isConnected ? "outline" : "cta"}
                    className="w-full"
                    onClick={() => handleToggleIntegration(it.platform)}
                  >
                    {isConnected ? <CheckCircle2 /> : <Plug />}
                    {isConnected ? "Desconectar Cuenta" : "Conectar Cuenta"}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
