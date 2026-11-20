import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouterState } from "@tanstack/react-router";
import type { Session, User } from "@supabase/supabase-js";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AuthScreen } from "@/components/AuthScreen";
import { LandingPage } from "@/components/LandingPage";
import {
  ensureUserPerfil,
  shouldResetBranchStoreOnAuthChange,
} from "@/lib/auth";
import { useBranchStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";

export interface AuthSessionContextValue {
  session: Session | null;
  user: User | null;
  isDemoMode: boolean;
  signOut: () => Promise<void>;
}

const AuthSessionContext = createContext<AuthSessionContextValue>({
  session: null,
  user: null,
  isDemoMode: true,
  signOut: async () => {},
});

/**
 * Devuelve el estado de sesión activa de Supabase Auth y la acción para cerrar sesión.
 */
export function useAuthSession(): AuthSessionContextValue {
  return useContext(AuthSessionContext);
}

/**
 * Protege todas las rutas de la aplicación cuando Supabase está configurado:
 * sin sesión activa muestra `AuthScreen` y limpia el store de sucursales al cambiar de usuario.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isPublicLandingRoute = pathname === "/landing";
  const [session, setSession] = useState<Session | null>(null);
  const [isChecking, setIsChecking] = useState<boolean>(Boolean(supabase));
  const previousUserIdRef = useRef<string | null>(null);
  const bootstrappedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setIsChecking(false);
      return;
    }

    let mounted = true;
    const client = supabase;

    const applySession = (nextSession: Session | null) => {
      if (!mounted) return;
      const nextUserId = nextSession?.user?.id ?? null;

      if (shouldResetBranchStoreOnAuthChange(previousUserIdRef.current, nextUserId)) {
        useBranchStore.getState().resetBranches();
        bootstrappedUserIdRef.current = null;
      }
      previousUserIdRef.current = nextUserId;
      setSession(nextSession);
      setIsChecking(false);

      if (nextSession?.user && bootstrappedUserIdRef.current !== nextSession.user.id) {
        bootstrappedUserIdRef.current = nextSession.user.id;
        void ensureUserPerfil(client, nextSession.user);
      }
    };

    client.auth
      .getSession()
      .then(({ data }) => {
        applySession(data.session ?? null);
      })
      .catch(() => {
        if (mounted) {
          setSession(null);
          setIsChecking(false);
        }
      });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      applySession(nextSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    useBranchStore.getState().resetBranches();
    bootstrappedUserIdRef.current = null;
    if (error) {
      toast.error("No se pudo cerrar sesión correctamente");
      return;
    }
    toast.success("Sesión cerrada");
  }, []);

  if (!supabase) {
    return (
      <AuthSessionContext.Provider
        value={{ session: null, user: null, isDemoMode: true, signOut }}
      >
        {children}
      </AuthSessionContext.Provider>
    );
  }

  if (isPublicLandingRoute) {
    return (
      <AuthSessionContext.Provider
        value={{
          session,
          user: session?.user ?? null,
          isDemoMode: !supabase,
          signOut,
        }}
      >
        {children}
      </AuthSessionContext.Provider>
    );
  }

  if (isChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span>Verificando sesión segura…</span>
        </div>
      </div>
    );
  }

  if (!session) {
    if (pathname === "/") {
      return (
        <AuthSessionContext.Provider
          value={{
            session: null,
            user: null,
            isDemoMode: false,
            signOut,
          }}
        >
          <LandingPage isAuthenticated={false} />
        </AuthSessionContext.Provider>
      );
    }
    return <AuthScreen />;
  }

  return (
    <AuthSessionContext.Provider
      value={{
        session,
        user: session.user,
        isDemoMode: false,
        signOut,
      }}
    >
      {children}
    </AuthSessionContext.Provider>
  );
}
