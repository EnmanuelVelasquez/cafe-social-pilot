import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ImageIcon,
  Instagram,
  Facebook,
  LogIn,
  MessageCircle,
  Quote,
  ShieldCheck,
  Wallet,
  Zap,
} from "lucide-react";
import imgCafeManana from "@/assets/a1.jpg";
import imgLatteTarde from "@/assets/a2.jpg";
import imgGranosOrigen from "@/assets/a3.jpg";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  LANDING_BENEFITS,
  LANDING_PAIN_POINTS,
  LANDING_PLANS,
  LANDING_PROOF_QUOTE,
  buildWhatsAppLeadUrl,
  type LandingBenefit,
} from "@/lib/landing";

const BENEFIT_VISUALS: Record<
  LandingBenefit["id"],
  { icon: typeof Clock; toneClass: string }
> = {
  tiempo: { icon: Clock, toneClass: "bg-primary-soft text-primary" },
  plata: { icon: Wallet, toneClass: "bg-success-soft text-success" },
  tranquilidad: { icon: ShieldCheck, toneClass: "bg-violet-soft text-violet" },
};

export interface LandingPageProps {
  /** Indica si el visitante ya tiene sesión iniciada para mostrar acceso directo al Dashboard. */
  isAuthenticated?: boolean | undefined;
}

/**
 * Landing page comercial de AutoSocial AI estructurada en los 6 bloques de conversión:
 * promesa, dolor, 3 beneficios, prueba real, precio transparente y CTA único a WhatsApp.
 */
export function LandingPage({ isAuthenticated = false }: LandingPageProps) {
  const defaultWhatsappHref = buildWhatsAppLeadUrl();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navegación superior limpia */}
      <header className="sticky top-0 z-30 border-b bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 md:px-8">
          <a href="#top" className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand shadow-glow">
              <Zap className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-display text-lg font-bold tracking-tight">
              AutoSocial <span className="text-brand">AI</span>
            </span>
          </a>

          <nav
            aria-label="Secciones de la página"
            className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex"
          >
            <a href="#dolor" className="transition-colors hover:text-foreground">
              El problema
            </a>
            <a href="#beneficios" className="transition-colors hover:text-foreground">
              Beneficios
            </a>
            <a href="#prueba" className="transition-colors hover:text-foreground">
              Prueba real
            </a>
            <a href="#precios" className="transition-colors hover:text-foreground">
              Precios
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to={isAuthenticated ? "/" : "/login"}>
                <LogIn className="h-4 w-4" />
                {isAuthenticated ? "Ir a mi panel" : "Iniciar sesión"}
              </Link>
            </Button>
            <Button variant="cta" size="sm" asChild className="hidden sm:inline-flex">
              <a
                href={defaultWhatsappHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle className="h-4 w-4" />
                WhatsApp
              </a>
            </Button>
          </div>
        </div>
      </header>

      <main id="top">
        {/* BLOQUE 1: La promesa en una frase */}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-12 md:grid-cols-12 md:px-8 md:pb-24 md:pt-20">
          <div className="space-y-6 md:col-span-7">
            <Badge
              variant="secondary"
              className="rounded-full px-3.5 py-1 text-xs font-medium"
            >
              Para cafeterías, comercios y PYMEs que venden en Instagram y Facebook
            </Badge>

            <h1 className="font-display text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl lg:text-5xl">
              Mantén tus redes activas toda la semana en{" "}
              <span className="text-brand">10 minutos</span>, sin trasnocharte ni pagar
              $1.200.000 a una agencia.
            </h1>

            <p className="max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Deja de improvisar publicaciones a las 11 de la noche. Prepara tus textos,
              organiza tus fotos y ten listo el calendario semanal con la voz real de tu
              negocio.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button variant="cta" size="lg" className="h-11 px-6 text-base shadow-glow" asChild>
                <a
                  href={defaultWhatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle className="h-5 w-5" />
                  Escríbeme al WhatsApp
                </a>
              </Button>
              <Button variant="outline" size="lg" className="h-11" asChild>
                <a href="#prueba">
                  Ver cómo se ve por dentro
                  <ArrowRight className="h-4 w-4" />
                </a>
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 text-xs font-medium text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-success" />
                Publicación Manual Asistida sin ataduras
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-success" />
                Piloto probado en Café Don Juan
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-success" />
                Sin contratos ni letra menuda
              </span>
            </div>
          </div>

          {/* Tarjeta visual de apoyo junto a la promesa */}
          <div className="md:col-span-5">
            <Card className="overflow-hidden border shadow-card">
              <CardHeader className="border-b bg-muted/40 pb-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Vista de cliente · Café Don Juan
                    </p>
                    <CardTitle className="mt-0.5 font-display text-base">
                      Semana lista para publicar
                    </CardTitle>
                  </div>
                  <Badge variant="published">Al día</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center gap-3 rounded-xl border border-warning/50 border-l-4 border-l-warning bg-card p-3">
                  <img
                    src={imgCafeManana}
                    alt="Taza de café artesanal lista para publicación de mañana"
                    className="h-16 w-16 shrink-0 rounded-lg object-cover"
                    width={64}
                    height={64}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-violet">
                        <Instagram className="h-3.5 w-3.5" /> Instagram · Hoy 8:00 a. m.
                      </span>
                      <Badge variant="pending">Por aprobar</Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      ¡Arranca el jueves con un tinto recién colado de origen colombiano y pan
                      caliente! Te esperamos en nuestra barra.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
                  <img
                    src={imgLatteTarde}
                    alt="Latte art preparado para publicación de la tarde"
                    className="h-16 w-16 shrink-0 rounded-lg object-cover"
                    width={64}
                    height={64}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                        <Facebook className="h-3.5 w-3.5" /> Facebook · Viernes 4:00 p. m.
                      </span>
                      <Badge variant="scheduled">Listo</Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      ¿Plan de tarde con buena conversación? Ven por tu capuchino favorito con
                      tu equipo o familia.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                  <div className="rounded-lg bg-primary-soft px-2 py-2">
                    <p className="font-display text-base font-bold text-primary">5</p>
                    <p className="text-[11px] text-muted-foreground">Listos semana</p>
                  </div>
                  <div className="rounded-lg bg-success-soft px-2 py-2">
                    <p className="font-display text-base font-bold text-success">14</p>
                    <p className="text-[11px] text-muted-foreground">Este mes</p>
                  </div>
                  <div className="rounded-lg bg-violet-soft px-2 py-2">
                    <p className="font-display text-base font-bold text-violet">10 min</p>
                    <p className="text-[11px] text-muted-foreground">Al lunes</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* BLOQUE 2: El dolor (con palabras reales del cliente) */}
        <section id="dolor" className="border-y bg-card py-16 md:py-20">
          <div className="mx-auto max-w-6xl px-4 md:px-8">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                El día a día real de un dueño
              </p>
              <h2 className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl">
                ¿Te suena familiar alguna de estas tres situaciones?
              </h2>
              <p className="mt-2 text-sm text-muted-foreground sm:text-base">
                No es falta de ganas ni de calidad en lo que vendes: simplemente el negocio
                absorbe todo tu día.
              </p>
            </div>

            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {LANDING_PAIN_POINTS.map((pain, index) => (
                <Card key={pain.id} className="border bg-background shadow-card">
                  <CardHeader className="pb-2">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-warning-soft font-display text-sm font-bold text-warning">
                      0{index + 1}
                    </span>
                    <CardTitle className="pt-2 font-display text-lg">
                      {pain.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {pain.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* BLOQUE 3: La solución en 3 beneficios (Tiempo · Plata · Tranquilidad) */}
        <section id="beneficios" className="mx-auto max-w-6xl px-4 py-16 md:px-8 md:py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-violet">
              Lo que cambia en tu semana
            </p>
            <h2 className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl">
              Recupera tiempo, cuida tu plata y publica con tranquilidad
            </h2>
          </div>

          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {LANDING_BENEFITS.map((benefit) => {
              const visual = BENEFIT_VISUALS[benefit.id];
              const Icon = visual.icon;
              return (
                <Card key={benefit.id} className="shadow-card">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div
                        className={`grid h-11 w-11 place-items-center rounded-xl ${visual.toneClass}`}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <Badge variant="outline">{benefit.label}</Badge>
                    </div>
                    <CardTitle className="pt-3 font-display text-lg">
                      {benefit.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {benefit.description}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        {/* BLOQUE 4: La prueba (vista real del producto + frase de validación) */}
        <section id="prueba" className="border-y bg-card py-16 md:py-20">
          <div className="mx-auto max-w-6xl px-4 md:px-8">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div className="max-w-2xl">
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                  Prueba real en operación
                </p>
                <h2 className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl">
                  Así organizas y publicas una pieza en menos de un minuto
                </h2>
                <p className="mt-2 text-sm text-muted-foreground sm:text-base">
                  Sin menús complejos: apruebas tu texto, descargas tu foto ya verificada y
                  llevas el conteo real del mes.
                </p>
              </div>
              <Badge variant="secondary" className="w-fit rounded-full px-3 py-1">
                Caso piloto: Café Don Juan
              </Badge>
            </div>

            {/* Marco realista de la app */}
            <div className="mt-8 rounded-2xl border bg-background p-4 shadow-card sm:p-6">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex items-center gap-3 rounded-xl border bg-card p-3.5">
                  <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary-soft text-primary">
                    <CalendarClock className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-display text-xl font-bold">4</p>
                    <p className="text-xs text-muted-foreground">Posts Programados</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-xl border bg-card p-3.5">
                  <div className="grid h-10 w-10 place-items-center rounded-lg bg-success-soft text-success">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-display text-xl font-bold">14</p>
                    <p className="text-xs text-muted-foreground">Publicados este mes</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-xl border bg-card p-3.5">
                  <div className="grid h-10 w-10 place-items-center rounded-lg bg-violet-soft text-violet">
                    <ImageIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-display text-xl font-bold">12</p>
                    <p className="text-xs text-muted-foreground">Fotos disponibles</p>
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <article className="flex flex-col gap-4 rounded-2xl border border-warning/60 border-l-4 border-l-warning bg-card p-4 shadow-card sm:flex-row">
                  <img
                    src={imgGranosOrigen}
                    alt="Granos tostados de café especial en barra"
                    className="aspect-square max-h-48 w-full shrink-0 self-start rounded-xl object-cover sm:h-28 sm:w-28"
                    width={112}
                    height={112}
                  />
                  <div className="flex min-w-0 flex-1 flex-col justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
                          <Instagram className="h-3.5 w-3.5 text-violet" /> Instagram
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
                          <Clock className="h-3.5 w-3.5" /> Jue 5:30 p. m.
                        </span>
                        <Badge variant="pending" className="rounded-full">
                          Pendiente de Aprobación
                        </Badge>
                      </div>
                      <p className="mt-2.5 text-sm leading-relaxed text-foreground">
                        Grano seleccionado y tueste fresco para cerrar la tarde como se debe.
                        Pasa por el tuyo o escríbenos por mensaje para llevar a tu oficina.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        <span className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 text-xs font-medium">
                          <Copy className="h-3.5 w-3.5" /> Copiar copy
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 text-xs font-medium">
                          <Download className="h-3.5 w-3.5" /> Imagen
                        </span>
                      </div>
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1 text-xs font-medium text-primary-foreground">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Aprobar y Programar
                      </span>
                    </div>
                  </div>
                </article>
              </div>
            </div>

            {/* Frase real del piloto / entrevista Discovery */}
            <Card className="mt-6 border bg-primary-soft/50">
              <CardContent className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
                    <Quote className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-display text-base font-semibold text-foreground sm:text-lg">
                      “{LANDING_PROOF_QUOTE.quote}”
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {LANDING_PROOF_QUOTE.author} · {LANDING_PROOF_QUOTE.context}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* BLOQUE 5: El precio claro y sin letra menuda */}
        <section id="precios" className="mx-auto max-w-6xl px-4 py-16 md:px-8 md:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              Precios transparentes
            </p>
            <h2 className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl">
              Empieza sin contratos ni letra menuda
            </h2>
            <p className="mt-2 text-sm text-muted-foreground sm:text-base">
              Paga menos de lo que cuesta un día de agencia al mes y cancela cuando quieras.
            </p>
          </div>

          <div className="mx-auto mt-10 grid max-w-4xl gap-6 md:grid-cols-2">
            {LANDING_PLANS.map((plan) => (
              <Card
                key={plan.id}
                className={
                  plan.highlighted
                    ? "flex flex-col border-2 border-primary shadow-glow"
                    : "flex flex-col shadow-card"
                }
              >
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="font-display text-xl">{plan.name}</CardTitle>
                    {plan.badge && <Badge variant="scheduled">{plan.badge}</Badge>}
                  </div>
                  <div className="flex items-baseline gap-1.5 pt-2">
                    <span className="font-display text-3xl font-bold tracking-tight text-cta">
                      {plan.priceLabel}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {plan.periodLabel}
                    </span>
                  </div>
                  <CardDescription className="pt-1">{plan.summary}</CardDescription>
                </CardHeader>

                <CardContent className="flex-1">
                  <ul className="space-y-2.5 text-sm">
                    {plan.features.map((feat) => (
                      <li key={feat} className="flex items-start gap-2.5">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                        <span className="text-foreground">{feat}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>

                <CardFooter>
                  <Button
                    variant={plan.highlighted ? "cta" : "outline"}
                    className="w-full"
                    size="lg"
                    asChild
                  >
                    <a
                      href={buildWhatsAppLeadUrl({ planName: plan.name })}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <MessageCircle className="h-4 w-4" />
                      Elegir por WhatsApp
                    </a>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </section>

        {/* BLOQUE 6: UNA sola acción final — Escríbeme al WhatsApp */}
        <section className="mx-auto max-w-6xl px-4 pb-16 md:px-8 md:pb-24">
          <div className="rounded-3xl bg-cta px-6 py-12 text-center text-primary-foreground shadow-card sm:px-12">
            <h2 className="mx-auto max-w-2xl font-display text-2xl font-bold tracking-tight sm:text-3xl">
              ¿Listo para tener tu semana de publicaciones resuelta en 10 minutos?
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-primary-foreground/85 sm:text-base">
              Cuéntame qué vende tu negocio y activamos tu primera semana de prueba hoy mismo.
            </p>
            <div className="mt-7 flex justify-center">
              <Button variant="brand" size="lg" className="h-12 px-8 text-base shadow-glow" asChild>
                <a
                  href={defaultWhatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle className="h-5 w-5" />
                  Escríbeme al WhatsApp
                </a>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t bg-card py-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-xs text-muted-foreground sm:flex-row md:px-8">
          <p>AutoSocial AI · Organización de contenido para redes sociales · Ley 1581 de 2012</p>
          <Link
            to={isAuthenticated ? "/" : "/login"}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {isAuthenticated ? "Ir al panel" : "Acceso clientes · Iniciar sesión"}
          </Link>
        </div>
      </footer>
    </div>
  );
}
