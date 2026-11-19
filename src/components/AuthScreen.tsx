import { useState, type FormEvent } from "react";
import { Loader2, Lock, Mail, ShieldCheck, Zap } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MIN_SIGNUP_PASSWORD_LENGTH,
  mapSupabaseAuthErrorMessage,
  validateAuthCredentials,
} from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/**
 * Pantalla de acceso y registro con Supabase Auth para aislar cada espacio por usuario.
 */
export function AuthScreen() {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;

    setErrorMessage(null);
    setInfoMessage(null);

    const check = validateAuthCredentials({ email, password, mode: "login" });
    if (!check.valid) {
      setErrorMessage(check.reason ?? "Revisa tus credenciales.");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: check.normalizedEmail,
        password,
      });
      if (error) {
        setErrorMessage(mapSupabaseAuthErrorMessage(error));
        return;
      }
      toast.success("Sesión iniciada correctamente");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;

    setErrorMessage(null);
    setInfoMessage(null);

    const check = validateAuthCredentials({
      email,
      password,
      confirmPassword,
      fullName,
      mode: "register",
    });
    if (!check.valid) {
      setErrorMessage(check.reason ?? "Revisa los datos del registro.");
      return;
    }

    setIsSubmitting(true);
    try {
      const signUpOptions: {
        emailRedirectTo?: string;
        data?: { full_name: string };
      } = {};
      if (typeof window !== "undefined") {
        signUpOptions.emailRedirectTo = window.location.origin;
      }
      if (check.normalizedName) {
        signUpOptions.data = { full_name: check.normalizedName };
      }

      const { data, error } = await supabase.auth.signUp({
        email: check.normalizedEmail,
        password,
        options: signUpOptions,
      });

      if (error) {
        setErrorMessage(mapSupabaseAuthErrorMessage(error));
        return;
      }

      if (data.session) {
        toast.success("Cuenta creada e inicio de sesión exitoso");
      } else {
        setInfoMessage(
          "Cuenta creada. Revisa tu correo electrónico para confirmar tu dirección antes de iniciar sesión.",
        );
        setPassword("");
        setConfirmPassword("");
        setTab("login");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!supabase) return;
    setErrorMessage(null);
    setInfoMessage(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setErrorMessage(
        "Escribe primero tu correo en el campo superior para enviarte el enlace de recuperación.",
      );
      return;
    }

    setIsResetting(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(
        cleanEmail,
        typeof window !== "undefined"
          ? { redirectTo: window.location.origin }
          : undefined,
      );
      if (error) {
        setErrorMessage(mapSupabaseAuthErrorMessage(error));
        return;
      }
      setInfoMessage(
        `Enviamos instrucciones para restablecer tu contraseña a ${cleanEmail}.`,
      );
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <div className="mb-6 flex items-center gap-2.5">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand shadow-glow">
          <Zap className="h-5 w-5 text-primary-foreground" />
        </div>
        <span className="font-display text-2xl font-bold tracking-tight">
          AutoSocial <span className="text-brand">AI</span>
        </span>
      </div>

      <Card className="w-full max-w-md shadow-card">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="font-display text-xl">Acceso a tu espacio</CardTitle>
          <CardDescription>
            Cada cuenta administra únicamente sus propias sucursales, activos y publicaciones.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorMessage && (
            <Alert variant="destructive">
              <AlertTitle>No se pudo continuar</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}
          {infoMessage && (
            <Alert>
              <ShieldCheck className="h-4 w-4" />
              <AlertTitle>Revisa tu correo</AlertTitle>
              <AlertDescription>{infoMessage}</AlertDescription>
            </Alert>
          )}

          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(v === "register" ? "register" : "login");
              setErrorMessage(null);
            }}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Iniciar sesión</TabsTrigger>
              <TabsTrigger value="register">Crear cuenta</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="mt-4">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">Correo electrónico</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="login-email"
                      type="email"
                      autoComplete="email"
                      placeholder="tu@negocio.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-9"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">Contraseña</Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="login-password"
                      type="password"
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-9"
                      required
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  variant="brand"
                  className="w-full"
                  disabled={isSubmitting}
                >
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Entrar al panel
                </Button>
                <div className="text-center">
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    onClick={handleResetPassword}
                    disabled={isResetting || isSubmitting}
                  >
                    {isResetting ? "Enviando enlace..." : "¿Olvidaste tu contraseña?"}
                  </Button>
                </div>
              </form>
            </TabsContent>

            <TabsContent value="register" className="mt-4">
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="register-name">Nombre del negocio o perfil (opcional)</Label>
                  <Input
                    id="register-name"
                    type="text"
                    autoComplete="organization"
                    placeholder="Ej. Café Don Juan"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-email">Correo electrónico</Label>
                  <Input
                    id="register-email"
                    type="email"
                    autoComplete="email"
                    placeholder="tu@negocio.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-password">
                    Contraseña (mínimo {MIN_SIGNUP_PASSWORD_LENGTH} caracteres)
                  </Label>
                  <Input
                    id="register-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-confirm">Confirmar contraseña</Label>
                  <Input
                    id="register-confirm"
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
                <Button
                  type="submit"
                  variant="brand"
                  className="w-full"
                  disabled={isSubmitting}
                >
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Crear cuenta segura
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
