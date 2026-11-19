export type CronAuthorizationResult =
  | { authorized: true; status: 200 }
  | { authorized: false; status: 401 | 503; error: string };

/**
 * Lee el secreto configurado para proteger el endpoint `/api/cron/publish-due`.
 * Prioriza el objeto `env` inyectado por el runtime (Nitro/Cloudflare/Vercel) y cae a `process.env`.
 */
export function resolveConfiguredCronSecret(
  envRecord?: Record<string, unknown>,
): string | undefined {
  const fromEnvRecord =
    envRecord && typeof envRecord["CRON_SECRET"] === "string"
      ? envRecord["CRON_SECRET"].trim()
      : "";
  if (fromEnvRecord) return fromEnvRecord;

  const fromProcess =
    typeof process !== "undefined" && typeof process.env?.["CRON_SECRET"] === "string"
      ? process.env["CRON_SECRET"].trim()
      : "";
  return fromProcess || undefined;
}

/**
 * Compara dos cadenas en tiempo constante para evitar fugas por temporización al validar secretos.
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    const codeA = i < a.length ? a.charCodeAt(i) : 0;
    const codeB = i < b.length ? b.charCodeAt(i) : 0;
    mismatch |= codeA ^ codeB;
  }
  return mismatch === 0;
}

/**
 * Valida la autorización de una petición cron con política fail-closed:
 * si `CRON_SECRET` no está configurado, rechaza con 503 en lugar de dejar el endpoint abierto.
 */
export function authorizeCronRequest(
  headers: Pick<Headers, "get">,
  configuredSecret: string | undefined,
): CronAuthorizationResult {
  const secret = configuredSecret?.trim() ?? "";
  if (!secret) {
    return {
      authorized: false,
      status: 503,
      error: "Endpoint cron deshabilitado: falta configurar CRON_SECRET en el servidor.",
    };
  }

  const authHeader = headers.get("authorization")?.trim() ?? "";
  const bearerToken =
    authHeader.length > 7 && authHeader.slice(0, 7).toLowerCase() === "bearer "
      ? authHeader.slice(7).trim()
      : "";
  const cronHeader = headers.get("x-cron-secret")?.trim() ?? "";

  const matchesBearer = bearerToken.length > 0 && timingSafeEqualStrings(bearerToken, secret);
  const matchesHeader = cronHeader.length > 0 && timingSafeEqualStrings(cronHeader, secret);

  if (!matchesBearer && !matchesHeader) {
    return {
      authorized: false,
      status: 401,
      error: "No autorizado (CRON_SECRET inválido).",
    };
  }

  return { authorized: true, status: 200 };
}

/**
 * Normaliza nombres de red social provenientes de la API Express (minúsculas) o de Supabase.
 */
export function normalizeSocialNetworkLabel(
  raw: string | null | undefined,
): "Instagram" | "Facebook" {
  return raw?.trim().toLowerCase() === "facebook" ? "Facebook" : "Instagram";
}
