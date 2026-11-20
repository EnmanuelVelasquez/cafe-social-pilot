import { Navigate, createFileRoute } from "@tanstack/react-router";
import { useAuthSession } from "@/components/AuthGate";
import { AuthScreen } from "@/components/AuthScreen";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Iniciar sesión — AutoSocial AI" },
      { name: "description", content: "Accede o crea tu cuenta privada en AutoSocial AI." },
    ],
  }),
  component: LoginRoute,
});

function LoginRoute() {
  const { user, isDemoMode } = useAuthSession();
  if (user || isDemoMode) {
    return <Navigate to="/" replace />;
  }
  return <AuthScreen />;
}
