import { createFileRoute } from "@tanstack/react-router";
import { useAuthSession } from "@/components/AuthGate";
import { LandingPage } from "@/components/LandingPage";

export const Route = createFileRoute("/landing")({
  head: () => ({
    meta: [
      { title: "AutoSocial AI — Tu semana en redes lista en 10 minutos" },
      {
        name: "description",
        content:
          "Mantén tu Instagram y Facebook activos toda la semana con textos y calendario listos para tu negocio, sin trasnocharte ni pagar agencias costosas.",
      },
      { property: "og:title", content: "AutoSocial AI — Tu semana en redes lista en 10 minutos" },
      {
        property: "og:description",
        content:
          "Organiza tus fotos, aprueba textos con el tono de tu negocio y publica toda la semana sin complicarte.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: LandingRoute,
});

function LandingRoute() {
  const { user } = useAuthSession();
  return <LandingPage isAuthenticated={Boolean(user)} />;
}
