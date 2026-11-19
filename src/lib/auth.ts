import type { SupabaseClient, User } from "@supabase/supabase-js";

export const MIN_SIGNUP_PASSWORD_LENGTH = 8;
export const MIN_LOGIN_PASSWORD_LENGTH = 6;

const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AuthCredentialsValidationInput {
  email: string;
  password: string;
  mode: "login" | "register";
  confirmPassword?: string | undefined;
  fullName?: string | undefined;
  acceptedPrivacyPolicy?: boolean | undefined;
}

export interface AuthCredentialsValidationResult {
  valid: boolean;
  normalizedEmail: string;
  normalizedName?: string | undefined;
  reason?: string | undefined;
}

/**
 * Valida correo, longitud mínima de contraseña y confirmación en login/registro.
 */
export function validateAuthCredentials(
  input: AuthCredentialsValidationInput,
): AuthCredentialsValidationResult {
  const normalizedEmail = input.email.trim().toLowerCase();
  const normalizedName = input.fullName?.trim() || undefined;

  if (!normalizedEmail || !EMAIL_FORMAT_REGEX.test(normalizedEmail)) {
    return {
      valid: false,
      normalizedEmail,
      normalizedName,
      reason: "Ingresa un correo electrónico válido.",
    };
  }

  const minLen =
    input.mode === "register"
      ? MIN_SIGNUP_PASSWORD_LENGTH
      : MIN_LOGIN_PASSWORD_LENGTH;

  if (!input.password || input.password.length < minLen) {
    return {
      valid: false,
      normalizedEmail,
      normalizedName,
      reason:
        input.mode === "register"
          ? `La contraseña debe tener al menos ${MIN_SIGNUP_PASSWORD_LENGTH} caracteres.`
          : `La contraseña debe tener al menos ${MIN_LOGIN_PASSWORD_LENGTH} caracteres.`,
    };
  }

  if (
    input.mode === "register" &&
    input.confirmPassword !== undefined &&
    input.password !== input.confirmPassword
  ) {
    return {
      valid: false,
      normalizedEmail,
      normalizedName,
      reason: "Las contraseñas no coinciden.",
    };
  }

  if (input.mode === "register" && input.acceptedPrivacyPolicy !== true) {
    return {
      valid: false,
      normalizedEmail,
      normalizedName,
      reason:
        "Debes autorizar el tratamiento de datos personales (Ley 1581) para crear tu cuenta.",
    };
  }

  return {
    valid: true,
    normalizedEmail,
    normalizedName,
  };
}

/**
 * Obtiene un nombre legible para el perfil a partir del nombre ingresado o el correo.
 */
export function deriveProfileDisplayName(
  email?: string | null | undefined,
  fullName?: string | null | undefined,
): string {
  const cleanName = fullName?.trim();
  if (cleanName) return cleanName;

  const localPart = email?.split("@")[0]?.trim();
  if (localPart) {
    return localPart.charAt(0).toUpperCase() + localPart.slice(1);
  }
  return "Mi Negocio";
}

/**
 * Determina si el store de sucursales debe limpiarse al cambiar o cerrar sesión
 * para evitar filtración de datos en memoria entre cuentas distintas.
 */
export function shouldResetBranchStoreOnAuthChange(
  previousUserId: string | null,
  nextUserId: string | null,
): boolean {
  return previousUserId !== null && previousUserId !== nextUserId;
}

/**
 * Detecta si la columna `user_id` aún no existe en la tabla `perfiles` de Supabase.
 */
export function isMissingUserIdColumnError(
  error: { code?: string | undefined; message?: string | undefined } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === "PGRST204" || error.code === "42703") return true;

  const message = (error.message ?? "").toLowerCase();
  if (!message.includes("user_id")) return false;

  return (
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("could not find")
  );
}

/**
 * Traduce errores comunes de Supabase Auth a mensajes claros en español sin exponer detalles técnicos.
 */
export function mapSupabaseAuthErrorMessage(error: unknown): string {
  const raw =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");
  const msg = raw.toLowerCase();

  if (msg.includes("invalid login credentials")) {
    return "Correo o contraseña incorrectos.";
  }
  if (msg.includes("email not confirmed")) {
    return "Debes confirmar tu correo electrónico antes de iniciar sesión (revisa tu bandeja o spam).";
  }
  if (msg.includes("user already registered") || msg.includes("already been registered")) {
    return "Este correo ya está registrado. Intenta iniciar sesión.";
  }
  if (msg.includes("rate limit") || msg.includes("too many requests")) {
    return "Demasiados intentos seguidos. Espera unos minutos e intenta de nuevo.";
  }
  if (msg.includes("password should be at least")) {
    return `La contraseña debe tener al menos ${MIN_LOGIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (msg.includes("unable to validate email")) {
    return "El formato del correo electrónico no es válido.";
  }
  return raw.trim() || "No se pudo completar la autenticación.";
}

/**
 * Garantiza que el usuario autenticado tenga una fila en `perfiles` asociada a su `user_id`
 * para poder crear y aislar sus propias sucursales bajo políticas RLS.
 */
export async function ensureUserPerfil(
  client: Pick<SupabaseClient, "from">,
  user: Pick<User, "id" | "email" | "user_metadata">,
): Promise<string | null> {
  const fullNameMeta =
    user.user_metadata && typeof user.user_metadata["full_name"] === "string"
      ? user.user_metadata["full_name"]
      : undefined;
  const displayName = deriveProfileDisplayName(user.email, fullNameMeta);

  const byUserRes = await client
    .from("perfiles")
    .select("id")
    .eq("user_id", user.id)
    .limit(1);

  if (!byUserRes.error) {
    const existing = Array.isArray(byUserRes.data)
      ? (byUserRes.data[0] as { id?: string } | undefined)
      : undefined;
    if (existing?.id) return existing.id;

    const createdRes = await client
      .from("perfiles")
      .insert([{ nombre: displayName, user_id: user.id }])
      .select("id")
      .single();

    if (!createdRes.error && createdRes.data) {
      return (createdRes.data as { id?: string }).id ?? null;
    }
    return null;
  }

  // Degradación controlada si la columna `user_id` aún no se ha creado en Supabase
  if (isMissingUserIdColumnError(byUserRes.error)) {
    const legacyRes = await client.from("perfiles").select("id").limit(1);
    const legacyExisting = Array.isArray(legacyRes.data)
      ? (legacyRes.data[0] as { id?: string } | undefined)
      : undefined;
    if (legacyExisting?.id) return legacyExisting.id;

    const createdLegacy = await client
      .from("perfiles")
      .insert([{ nombre: displayName }])
      .select("id")
      .single();
    if (!createdLegacy.error && createdLegacy.data) {
      return (createdLegacy.data as { id?: string }).id ?? null;
    }
  }

  return null;
}
