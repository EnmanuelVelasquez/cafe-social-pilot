import { createFileRoute } from "@tanstack/react-router";
import { Plus, Save, Plug, Instagram, Facebook } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

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

const branches = [
  { id: "centro", name: "Sede Centro" },
  { id: "norte", name: "Sede Norte" },
];

const integrations = [
  { name: "Meta Graph API (Instagram/Facebook)", desc: "Publica automáticamente en tu cuenta de Instagram Business y tu página de Facebook.", icons: [Instagram, Facebook] },
];

function Settings() {
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
              <Select defaultValue="centro">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline"><Plus /> Añadir nueva sucursal</Button>
          </div>

          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="font-display">Editar sucursal</CardTitle>
              <CardDescription>Ajusta cómo la IA habla en nombre de esta sede.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="branch-name">Nombre de la Sucursal</Label>
                <Input id="branch-name" defaultValue="Sede Centro" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch-tone">Tono de Voz</Label>
                <Textarea id="branch-tone" rows={3} defaultValue="Cercano y cálido, como un barista que conoce a sus clientes por su nombre." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch-rules">Reglas Negativas (Negative Prompts)</Label>
                <Textarea id="branch-rules" rows={3} defaultValue={'Nunca mencionar a la competencia. No usar "barato" ni "instantáneo".'} />
              </div>
            </CardContent>
            <CardFooter className="justify-end">
              <Button variant="cta"><Save /> Guardar Cambios</Button>
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
