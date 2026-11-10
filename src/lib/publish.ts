import type { PublishStatus } from "@/types";

export const PUBLISH_STATUSES: readonly PublishStatus[] = [
  "pendiente",
  "programado",
  "publicando",
  "publicado",
  "error",
] as const;

/**
 * Política de backoff exponencial / escalonado para errores recuperables:
 * Intento 1 -> 1 min, Intento 2 -> 5 min, Intento 3 -> 15 min.
 */
export const BACKOFF_DELAYS_MS = [60_000, 300_000, 900_000] as const;

/** Tope máximo de reintentos automáticos antes de requerir acción manual. */
export const MAX_PUBLISH_ATTEMPTS = 3;

/** Límite oficial de Meta Graph API: máximo 25 publicaciones por cuenta de Instagram cada 24 horas. */
export const META_IG_DAILY_PUBLISH_LIMIT = 25;

/** Ventana móvil de 24 horas en milisegundos para la cuota de Instagram. */
export const META_IG_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Versión base de Meta Graph API. */
export const META_GRAPH_API_VERSION = "v21.0";
export const META_GRAPH_BASE_URL = `https://graph.facebook.com/${META_GRAPH_API_VERSION}`;

/** Tope de lecturas de estado del contenedor de Instagram antes de abortar. */
export const IG_CONTAINER_MAX_POLLS = 5;
export const IG_CONTAINER_POLL_INTERVAL_MS = 1_500;

export type PublishTransitionTrigger =
  | "approve"
  | "claim"
  | "succeed"
  | "fail"
  | "retry_manual"
  | "retry_backoff";

export interface StateTransitionResult {
  valid: boolean;
  from: PublishStatus;
  to: PublishStatus;
  reason?: string | undefined;
}

/**
 * Normaliza cualquier representación textual del estado de publicación
 * al conjunto canónico `PublishStatus`.
 */
export function normalizePublishStatus(raw: string | null | undefined): PublishStatus {
  const cleaned = (raw ?? "").trim().toLowerCase();
  switch (cleaned) {
    case "pendiente":
      return "pendiente";
    case "programado":
    case "programada":
      return "programado";
    case "publicando":
    case "en_proceso":
      return "publicando";
    case "publicado":
    case "publicada":
      return "publicado";
    case "error":
    case "fallido":
    case "fallida":
      return "error";
    default:
      return "pendiente";
  }
}

/**
 * Máquina de estados permitida para publicaciones:
 * - `pendiente -> programado`
 * - `programado -> publicando` (bloqueado si ya existe `id_externo`)
 * - `publicando -> publicado | error`
 * - `error -> programado` (solo con `explicitRetry: true`)
 * - `publicado` es terminal e inmutable.
 */
export function canTransitionPublishStatus(
  fromRaw: string | null | undefined,
  to: PublishStatus,
  options?: {
    explicitRetry?: boolean | undefined;
    hasExternalId?: boolean | undefined;
  },
): StateTransitionResult {
  const from = normalizePublishStatus(fromRaw);

  if (from === "publicado") {
    return {
      valid: false,
      from,
      to,
      reason: "Una publicación en estado 'publicado' es inmutable y no puede cambiar de estado.",
    };
  }

  if (options?.hasExternalId && (to === "publicando" || to === "programado")) {
    return {
      valid: false,
      from,
      to,
      reason: "La publicación ya tiene un id_externo registrado en Meta (idempotencia).",
    };
  }

  if (from === "pendiente" && to === "programado") {
    return { valid: true, from, to };
  }

  if (from === "programado" && to === "publicando") {
    return { valid: true, from, to };
  }

  if (from === "publicando" && (to === "publicado" || to === "error")) {
    return { valid: true, from, to };
  }

  if (from === "error" && to === "programado") {
    if (options?.explicitRetry === true) {
      return { valid: true, from, to };
    }
    return {
      valid: false,
      from,
      to,
      reason: "La transición de 'error' a 'programado' requiere una acción explícita de reintento.",
    };
  }

  return {
    valid: false,
    from,
    to,
    reason: `Transición de estado no permitida: '${from}' -> '${to}'.`,
  };
}

/**
 * Verifica si una publicación debe omitirse por idempotencia o por no estar lista para despacho.
 */
export function isIdempotentSkip(post: {
  estado: string | null | undefined;
  id_externo?: string | null | undefined;
}): { skip: boolean; reason?: string | undefined } {
  const externalId = (post.id_externo ?? "").trim();
  if (externalId.length > 0) {
    return {
      skip: true,
      reason: `Publicación ya enviada a Meta (id_externo: ${externalId}).`,
    };
  }

  const status = normalizePublishStatus(post.estado);
  if (status === "publicado") {
    return {
      skip: true,
      reason: "La publicación ya figura como 'publicado'.",
    };
  }

  if (status === "publicando") {
    return {
      skip: true,
      reason: "La publicación ya está siendo procesada por otro worker ('publicando').",
    };
  }

  if (status !== "programado") {
    return {
      skip: true,
      reason: `La publicación está en estado '${status}'; solo se despachan publicaciones en estado 'programado'.`,
    };
  }

  return { skip: false };
}

export type MetaErrorCategory =
  | "TOKEN_EXPIRED"
  | "PERMISSION_DENIED"
  | "RATE_LIMIT"
  | "INVALID_MEDIA_OR_PARAM"
  | "IG_CONTAINER_ERROR"
  | "TRANSIENT"
  | "UNKNOWN";

export interface ClassifiedMetaError {
  code?: number | undefined;
  subcode?: number | undefined;
  category: MetaErrorCategory;
  userMessage: string;
  rawMessage: string;
  retryable: boolean;
  pauseIntegration: boolean;
}

interface RawMetaGraphErrorObject {
  message?: unknown;
  type?: unknown;
  code?: unknown;
  error_subcode?: unknown;
  error_user_title?: unknown;
  error_user_msg?: unknown;
}

function extractMetaErrorFields(rawError: unknown): {
  code?: number | undefined;
  subcode?: number | undefined;
  message: string;
  userTitle?: string | undefined;
  userMsg?: string | undefined;
} {
  if (!rawError) {
    return { message: "Error desconocido al comunicar con Meta Graph API." };
  }

  if (typeof rawError === "string") {
    try {
      const parsed = JSON.parse(rawError) as unknown;
      return extractMetaErrorFields(parsed);
    } catch {
      return { message: rawError };
    }
  }

  if (typeof rawError === "object") {
    const record = rawError as Record<string, unknown>;
    const nested =
      record["error"] && typeof record["error"] === "object"
        ? (record["error"] as RawMetaGraphErrorObject)
        : (record as RawMetaGraphErrorObject);

    const code = typeof nested.code === "number" ? nested.code : undefined;
    const subcode =
      typeof nested.error_subcode === "number" ? nested.error_subcode : undefined;
    const userTitle =
      typeof nested.error_user_title === "string" && nested.error_user_title.trim()
        ? nested.error_user_title.trim()
        : undefined;
    const userMsg =
      typeof nested.error_user_msg === "string" && nested.error_user_msg.trim()
        ? nested.error_user_msg.trim()
        : undefined;
    const message =
      typeof nested.message === "string" && nested.message.trim()
        ? nested.message.trim()
        : rawError instanceof Error && rawError.message
          ? rawError.message
          : "Error inesperado en Meta Graph API.";

    return {
      code,
      subcode,
      message,
      userTitle,
      userMsg,
    };
  }

  return { message: String(rawError) };
}

/**
 * Traduce respuestas de error de Meta Graph API (códigos 190, 4, 17, 32, 613, 10, 200, 100, 9007, 5xx)
 * a categorías accionables y mensajes humanos claros en español.
 */
export function classifyMetaGraphError(
  rawError: unknown,
  httpStatus?: number,
): ClassifiedMetaError {
  const { code, subcode, message, userMsg } = extractMetaErrorFields(rawError);
  const detailSuffix = userMsg ? ` Detalle: ${userMsg}` : "";

  // 190: Access token has expired, been revoked, or is invalid -> PAUSA INMEDIATA
  if (
    code === 190 ||
    httpStatus === 401 ||
    /error validating access token|session has expired|invalid oauth access token/i.test(message)
  ) {
    return {
      code: code ?? 190,
      subcode,
      category: "TOKEN_EXPIRED",
      rawMessage: message,
      userMessage: `El token de acceso de Meta expiró o fue revocado (código ${code ?? 190}). Renueva el token en Ajustes → Integraciones para reanudar las publicaciones.${detailSuffix}`,
      retryable: false,
      pauseIntegration: true,
    };
  }

  // 4, 17, 32, 613 o HTTP 429: Rate Limit
  if (
    code === 4 ||
    code === 17 ||
    code === 32 ||
    code === 613 ||
    httpStatus === 429 ||
    /rate limit|too many calls|request limit reached|application request limit/i.test(message)
  ) {
    const codeLabel = code !== undefined ? ` (código ${code})` : "";
    return {
      code,
      subcode,
      category: "RATE_LIMIT",
      rawMessage: message,
      userMessage: `Meta aplicó un límite temporal de solicitudes${codeLabel}. Se reprogramará con espera progresiva.${detailSuffix}`,
      retryable: true,
      pauseIntegration: false,
    };
  }

  // 10, 200..299 o HTTP 403: Permisos insuficientes
  if (
    code === 10 ||
    (code !== undefined && code >= 200 && code < 300) ||
    httpStatus === 403 ||
    /permission|requires.*permission|not authorized/i.test(message)
  ) {
    const codeLabel = code !== undefined ? ` (código ${code})` : "";
    return {
      code,
      subcode,
      category: "PERMISSION_DENIED",
      rawMessage: message,
      userMessage: `Faltan permisos en la cuenta o página de Meta${codeLabel}. Verifica que el token incluya 'pages_manage_posts' e 'instagram_content_publish'.${detailSuffix}`,
      retryable: false,
      pauseIntegration: false,
    };
  }

  // 9007 o contenedor de Instagram en estado ERROR / EXPIRED / IN_PROGRESS
  if (
    code === 9007 ||
    subcode === 2207027 ||
    /media id is not available|container.*not ready|status_code.*(error|expired|in_progress)/i.test(
      message,
    )
  ) {
    return {
      code: code ?? 9007,
      subcode,
      category: "IG_CONTAINER_ERROR",
      rawMessage: message,
      userMessage: `Instagram aún no terminó de procesar el contenedor multimedia o reportó un fallo temporal.${detailSuffix}`,
      retryable: true,
      pauseIntegration: false,
    };
  }

  // 100, 36000..36003: Parámetros o imagen inválida
  if (
    code === 100 ||
    code === 36000 ||
    code === 36001 ||
    code === 36003 ||
    subcode === 2207004 ||
    subcode === 2207005 ||
    subcode === 2207009 ||
    /invalid parameter|aspect ratio|image_url|only photo or video can be accepted/i.test(message)
  ) {
    const codeLabel = code !== undefined ? ` (código ${code})` : "";
    return {
      code,
      subcode,
      category: "INVALID_MEDIA_OR_PARAM",
      rawMessage: message,
      userMessage: `Meta rechazó la imagen o los parámetros de la publicación${codeLabel}. Verifica que la URL de la imagen sea pública y cumpla el formato de Meta.${detailSuffix}`,
      retryable: false,
      pauseIntegration: false,
    };
  }

  // 1, 2 o HTTP 5xx / fallo de red transitorio
  if (
    code === 1 ||
    code === 2 ||
    (httpStatus !== undefined && httpStatus >= 500) ||
    /network|fetch failed|timeout|temporarily unavailable|econnreset/i.test(message)
  ) {
    return {
      code,
      subcode,
      category: "TRANSIENT",
      rawMessage: message,
      userMessage: `Error temporal de conexión con Meta Graph API (${message}). Puedes reintentar en unos minutos.`,
      retryable: true,
      pauseIntegration: false,
    };
  }

  return {
    code,
    subcode,
    category: "UNKNOWN",
    rawMessage: message,
    userMessage: `Meta Graph API devolvió un error: ${message}${detailSuffix}`,
    retryable: false,
    pauseIntegration: false,
  };
}

export interface RetryDecision {
  shouldRetry: boolean;
  nextAttempt: number;
  delayMs?: number | undefined;
  nextScheduledAtIso?: string | undefined;
  pauseIntegration: boolean;
  reason: string;
}

/**
 * Calcula la decisión de reintento según la política de backoff (1m -> 5m -> 15m)
 * con tope de `MAX_PUBLISH_ATTEMPTS` (3) y pausa inmediata ante error `190`.
 *
 * @param currentAttempts Número de intentos fallidos previos (0 en el primer intento).
 */
export function computeRetryBackoff(
  currentAttempts: number,
  classifiedError: ClassifiedMetaError,
  now: Date = new Date(),
): RetryDecision {
  const safeCurrent = Math.max(0, Math.floor(currentAttempts));
  const nextAttempt = safeCurrent + 1;

  if (classifiedError.pauseIntegration || classifiedError.category === "TOKEN_EXPIRED") {
    return {
      shouldRetry: false,
      nextAttempt,
      pauseIntegration: true,
      reason: "Pausa inmediata: el token de Meta expiró o es inválido (código 190).",
    };
  }

  if (!classifiedError.retryable) {
    return {
      shouldRetry: false,
      nextAttempt,
      pauseIntegration: false,
      reason: `Error no recuperable automáticamente (${classifiedError.category}).`,
    };
  }

  if (nextAttempt > MAX_PUBLISH_ATTEMPTS) {
    return {
      shouldRetry: false,
      nextAttempt,
      pauseIntegration: false,
      reason: `Se alcanzó el límite máximo de ${MAX_PUBLISH_ATTEMPTS} reintentos automáticos.`,
    };
  }

  const backoffIndex = Math.min(nextAttempt - 1, BACKOFF_DELAYS_MS.length - 1);
  const delayMs = BACKOFF_DELAYS_MS[backoffIndex] ?? BACKOFF_DELAYS_MS[0];
  const nextScheduledAtIso = new Date(now.getTime() + delayMs).toISOString();

  return {
    shouldRetry: true,
    nextAttempt,
    delayMs,
    nextScheduledAtIso,
    pauseIntegration: false,
    reason: `Reintento ${nextAttempt}/${MAX_PUBLISH_ATTEMPTS} programado en ${Math.round(delayMs / 60_000)} min.`,
  };
}

export interface InstagramQuotaCheckResult {
  allowed: boolean;
  publishedLast24h: number;
  remaining: number;
  reason?: string | undefined;
}

/**
 * Verifica el límite duro de 25 publicaciones en las últimas 24 horas por cuenta de Instagram.
 */
export function checkInstagramDailyQuota(
  posts: ReadonlyArray<{
    red_social?: string | undefined;
    network?: string | undefined;
    estado?: string | undefined;
    status?: string | undefined;
    publicado_en?: string | null | undefined;
    publishedAtIso?: string | null | undefined;
    fecha_publicacion?: string | null | undefined;
    scheduledAtIso?: string | null | undefined;
  }>,
  now: Date = new Date(),
): InstagramQuotaCheckResult {
  const nowMs = now.getTime();
  const windowStartMs = nowMs - META_IG_DAILY_WINDOW_MS;

  const publishedLast24h = posts.filter((item) => {
    const net = (item.red_social ?? item.network ?? "").trim().toLowerCase();
    if (net !== "instagram") return false;

    const status = normalizePublishStatus(item.estado ?? item.status);
    if (status !== "publicado") return false;

    const timestampRaw =
      item.publicado_en ??
      item.publishedAtIso ??
      item.fecha_publicacion ??
      item.scheduledAtIso;
    if (!timestampRaw) return false;

    const parsedMs = new Date(timestampRaw).getTime();
    if (Number.isNaN(parsedMs)) return false;

    return parsedMs >= windowStartMs && parsedMs <= nowMs;
  }).length;

  const remaining = Math.max(0, META_IG_DAILY_PUBLISH_LIMIT - publishedLast24h);
  if (publishedLast24h >= META_IG_DAILY_PUBLISH_LIMIT) {
    return {
      allowed: false,
      publishedLast24h,
      remaining: 0,
      reason: `Se alcanzó el límite de ${META_IG_DAILY_PUBLISH_LIMIT} publicaciones de Instagram en las últimas 24 horas (${publishedLast24h}/${META_IG_DAILY_PUBLISH_LIMIT}). Espera a que se libere cupo antes de publicar.`,
    };
  }

  return {
    allowed: true,
    publishedLast24h,
    remaining,
  };
}

/**
 * Filtra y ordena las publicaciones vencidas listas para despacho (`estado = 'programado'` y `fecha_publicacion <= now`).
 */
export function filterDueScheduledPosts<
  T extends {
    id: string;
    estado: string;
    fecha_publicacion: string;
    id_externo?: string | null | undefined;
  },
>(posts: ReadonlyArray<T>, now: Date = new Date()): T[] {
  const nowMs = now.getTime();

  return posts
    .filter((post) => {
      if (isIdempotentSkip(post).skip) return false;
      const scheduledMs = new Date(post.fecha_publicacion).getTime();
      if (Number.isNaN(scheduledMs)) return false;
      return scheduledMs <= nowMs;
    })
    .slice()
    .sort(
      (a, b) =>
        new Date(a.fecha_publicacion).getTime() -
        new Date(b.fecha_publicacion).getTime(),
    );
}

/**
 * Determina si el token de una integración social está marcado como expirado (`token_expira_en <= now`).
 */
export function isIntegrationTokenExpired(
  integration:
    | {
        token_expira_en?: string | null | undefined;
      }
    | null
    | undefined,
  now: Date = new Date(),
): boolean {
  if (!integration?.token_expira_en) return false;
  const expiresMs = new Date(integration.token_expira_en).getTime();
  if (Number.isNaN(expiresMs)) return false;
  return expiresMs <= now.getTime();
}

/**
 * Detecta errores de PostgREST / Postgres cuando aún no se han ejecutado las migraciones
 * de las columnas nuevas de Etapa 4 (`ultimo_error`, `intentos`, `publicado_en`, `id_externo`,
 * `page_id`, `ig_user_id`, `token_expira_en`).
 */
export function isMissingPublishColumnsError(
  error: { code?: string | undefined; message?: string | undefined } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === "PGRST204" || error.code === "42703") return true;

  const message = (error.message ?? "").toLowerCase();
  const stage4Columns = [
    "ultimo_error",
    "intentos",
    "publicado_en",
    "id_externo",
    "page_id",
    "ig_user_id",
    "token_expira_en",
  ];
  if (!stage4Columns.some((col) => message.includes(col))) return false;

  return (
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("could not find")
  );
}

export interface MetaResolvedCredentials {
  pageId: string;
  pageAccessToken: string;
  igUserId?: string | undefined;
}

export interface ResolveMetaCredentialsInput {
  accessToken: string;
  network: "Instagram" | "Facebook";
  pageId?: string | null | undefined;
  igUserId?: string | null | undefined;
  fetchFn?: typeof fetch | undefined;
  baseUrl?: string | undefined;
}

export class MetaGraphApiError extends Error {
  readonly classified: ClassifiedMetaError;
  readonly httpStatus?: number | undefined;

  constructor(classified: ClassifiedMetaError, httpStatus?: number) {
    super(classified.userMessage);
    this.name = "MetaGraphApiError";
    this.classified = classified;
    this.httpStatus = httpStatus;
  }
}

async function parseGraphJsonOrThrow(
  response: Response,
): Promise<Record<string, unknown>> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const classified = classifyMetaGraphError(
      payload ?? { error: { message: `HTTP ${response.status}` } },
      response.status,
    );
    throw new MetaGraphApiError(classified, response.status);
  }

  if (
    payload &&
    typeof payload === "object" &&
    "error" in (payload as Record<string, unknown>) &&
    (payload as Record<string, unknown>)["error"]
  ) {
    const classified = classifyMetaGraphError(payload, response.status);
    throw new MetaGraphApiError(classified, response.status);
  }

  return (payload as Record<string, unknown>) ?? {};
}

/**
 * Resuelve `page_id`, `page_access_token` e `ig_user_id`:
 * - Si ya están presentes en las columnas de `integraciones_sociales` (o variables de entorno), los usa directo.
 * - Si faltan, consulta `GET /me/accounts?fields=id,name,access_token,instagram_business_account`.
 */
export async function resolveMetaAccountCredentials(
  input: ResolveMetaCredentialsInput,
): Promise<MetaResolvedCredentials> {
  const token = input.accessToken.trim();
  if (!token) {
    throw new MetaGraphApiError(
      classifyMetaGraphError({
        error: {
          code: 190,
          message: "No se encontró un token de acceso de Meta configurado.",
        },
      }),
    );
  }

  const cleanPageId = input.pageId?.trim() || undefined;
  const cleanIgUserId = input.igUserId?.trim() || undefined;

  if (
    cleanPageId &&
    (input.network === "Facebook" || Boolean(cleanIgUserId))
  ) {
    return {
      pageId: cleanPageId,
      pageAccessToken: token,
      igUserId: cleanIgUserId,
    };
  }

  const fetchImpl = input.fetchFn ?? fetch;
  const baseUrl = input.baseUrl ?? META_GRAPH_BASE_URL;
  const url = new URL(`${baseUrl}/me/accounts`);
  url.searchParams.set("fields", "id,name,access_token,instagram_business_account");
  url.searchParams.set("access_token", token);

  let response: Response;
  try {
    response = await fetchImpl(url.toString(), { method: "GET" });
  } catch (err) {
    throw new MetaGraphApiError(classifyMetaGraphError(err));
  }

  const body = await parseGraphJsonOrThrow(response);
  const accounts = Array.isArray(body["data"])
    ? (body["data"] as Array<Record<string, unknown>>)
    : [];

  const matchedAccount = cleanPageId
    ? accounts.find((acc) => String(acc["id"] ?? "") === cleanPageId)
    : accounts[0];

  if (!matchedAccount) {
    // Fallback: si el token ya es un Page Access Token directo (donde /me/accounts devuelve vacío),
    // consultamos GET /me?fields=id,instagram_business_account
    const meUrl = new URL(`${baseUrl}/me`);
    meUrl.searchParams.set("fields", "id,name,instagram_business_account");
    meUrl.searchParams.set("access_token", token);

    let meResp: Response;
    try {
      meResp = await fetchImpl(meUrl.toString(), { method: "GET" });
    } catch (err) {
      throw new MetaGraphApiError(classifyMetaGraphError(err));
    }

    const meBody = await parseGraphJsonOrThrow(meResp);
    const meId = typeof meBody["id"] === "string" ? meBody["id"].trim() : "";
    const meIgObj =
      meBody["instagram_business_account"] &&
      typeof meBody["instagram_business_account"] === "object"
        ? (meBody["instagram_business_account"] as Record<string, unknown>)
        : undefined;
    const meIgId =
      cleanIgUserId ??
      (typeof meIgObj?.["id"] === "string" ? meIgObj["id"].trim() : undefined);

    if (!meId) {
      throw new MetaGraphApiError(
        classifyMetaGraphError({
          error: {
            code: 200,
            message:
              "No se encontraron páginas de Facebook administradas por este token en /me/accounts.",
          },
        }),
      );
    }

    if (input.network === "Instagram" && !meIgId) {
      throw new MetaGraphApiError(
        classifyMetaGraphError({
          error: {
            code: 200,
            message:
              "La página de Facebook no tiene una cuenta de Instagram Business vinculada.",
          },
        }),
      );
    }

    return {
      pageId: cleanPageId ?? meId,
      pageAccessToken: token,
      igUserId: meIgId,
    };
  }

  const resolvedPageId =
    cleanPageId ??
    (typeof matchedAccount["id"] === "string" ? matchedAccount["id"].trim() : "");
  const resolvedPageToken =
    typeof matchedAccount["access_token"] === "string" &&
    matchedAccount["access_token"].trim()
      ? matchedAccount["access_token"].trim()
      : token;
  const igObj =
    matchedAccount["instagram_business_account"] &&
    typeof matchedAccount["instagram_business_account"] === "object"
      ? (matchedAccount["instagram_business_account"] as Record<string, unknown>)
      : undefined;
  const resolvedIgUserId =
    cleanIgUserId ??
    (typeof igObj?.["id"] === "string" ? igObj["id"].trim() : undefined);

  if (!resolvedPageId) {
    throw new MetaGraphApiError(
      classifyMetaGraphError({
        error: {
          code: 200,
          message: "No se pudo resolver el page_id desde Meta Graph API.",
        },
      }),
    );
  }

  if (input.network === "Instagram" && !resolvedIgUserId) {
    throw new MetaGraphApiError(
      classifyMetaGraphError({
        error: {
          code: 200,
          message:
            "La página de Facebook seleccionada no tiene una cuenta de Instagram Business vinculada.",
        },
      }),
    );
  }

  return {
    pageId: resolvedPageId,
    pageAccessToken: resolvedPageToken,
    igUserId: resolvedIgUserId,
  };
}

export interface PublishToInstagramInput {
  igUserId: string;
  accessToken: string;
  imageUrl: string;
  caption: string;
  fetchFn?: typeof fetch | undefined;
  baseUrl?: string | undefined;
  maxPolls?: number | undefined;
  pollIntervalMs?: number | undefined;
  sleepFn?: ((ms: number) => Promise<void>) | undefined;
}

/**
 * Flujo oficial de publicación en Instagram Feed (Graph API):
 * 1. `POST /{ig-user-id}/media` (`image_url`, `caption`) -> obtiene `creation_id`.
 * 2. Espera `status_code = FINISHED` consultando `GET /{creation_id}?fields=status_code` con tope de intentos.
 * 3. `POST /{ig-user-id}/media_publish` (`creation_id`) -> devuelve `externalId`.
 */
export async function publishToInstagramFeed(
  input: PublishToInstagramInput,
): Promise<{ externalId: string; creationId: string }> {
  const fetchImpl = input.fetchFn ?? fetch;
  const baseUrl = input.baseUrl ?? META_GRAPH_BASE_URL;
  const maxPolls = input.maxPolls ?? IG_CONTAINER_MAX_POLLS;
  const pollIntervalMs = input.pollIntervalMs ?? IG_CONTAINER_POLL_INTERVAL_MS;
  const sleep =
    input.sleepFn ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  // Paso 1: Crear contenedor multimedia
  let createResp: Response;
  try {
    createResp = await fetchImpl(`${baseUrl}/${encodeURIComponent(input.igUserId)}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: input.imageUrl,
        caption: input.caption,
        access_token: input.accessToken,
      }),
    });
  } catch (err) {
    throw new MetaGraphApiError(classifyMetaGraphError(err));
  }

  const createBody = await parseGraphJsonOrThrow(createResp);
  const creationId =
    typeof createBody["id"] === "string" ? createBody["id"].trim() : "";
  if (!creationId) {
    throw new MetaGraphApiError(
      classifyMetaGraphError({
        error: {
          code: 9007,
          message: "Instagram no devolvió un creation_id al crear el contenedor multimedia.",
        },
      }),
    );
  }

  // Paso 2: Polling corto hasta status_code = FINISHED
  let finished = maxPolls <= 0;
  let lastStatusCode = "IN_PROGRESS";

  for (let attempt = 1; attempt <= maxPolls; attempt++) {
    const statusUrl = new URL(`${baseUrl}/${encodeURIComponent(creationId)}`);
    statusUrl.searchParams.set("fields", "status_code,status");
    statusUrl.searchParams.set("access_token", input.accessToken);

    let statusResp: Response;
    try {
      statusResp = await fetchImpl(statusUrl.toString(), { method: "GET" });
    } catch (err) {
      throw new MetaGraphApiError(classifyMetaGraphError(err));
    }

    const statusBody = await parseGraphJsonOrThrow(statusResp);
    const rawStatus =
      typeof statusBody["status_code"] === "string"
        ? statusBody["status_code"].trim().toUpperCase()
        : "FINISHED";
    lastStatusCode = rawStatus;

    if (rawStatus === "FINISHED" || rawStatus === "PUBLISHED") {
      finished = true;
      break;
    }

    if (rawStatus === "ERROR" || rawStatus === "EXPIRED") {
      const statusDetail =
        typeof statusBody["status"] === "string" ? statusBody["status"] : rawStatus;
      throw new MetaGraphApiError(
        classifyMetaGraphError({
          error: {
            code: 9007,
            message: `El contenedor de Instagram falló con status_code=${rawStatus} (${statusDetail}).`,
          },
        }),
      );
    }

    if (attempt < maxPolls && pollIntervalMs > 0) {
      await sleep(pollIntervalMs);
    }
  }

  if (!finished) {
    throw new MetaGraphApiError(
      classifyMetaGraphError({
        error: {
          code: 9007,
          message: `El contenedor de Instagram sigue en status_code=${lastStatusCode} tras ${maxPolls} verificaciones.`,
        },
      }),
    );
  }

  // Paso 3: Publicar el contenedor
  let publishResp: Response;
  try {
    publishResp = await fetchImpl(
      `${baseUrl}/${encodeURIComponent(input.igUserId)}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: creationId,
          access_token: input.accessToken,
        }),
      },
    );
  } catch (err) {
    throw new MetaGraphApiError(classifyMetaGraphError(err));
  }

  const publishBody = await parseGraphJsonOrThrow(publishResp);
  const externalId =
    typeof publishBody["id"] === "string" ? publishBody["id"].trim() : "";

  if (!externalId) {
    throw new MetaGraphApiError(
      classifyMetaGraphError({
        error: {
          code: 9007,
          message: "Instagram no devolvió el id_externo al publicar el contenedor.",
        },
      }),
    );
  }

  return { externalId, creationId };
}

export interface PublishToFacebookInput {
  pageId: string;
  accessToken: string;
  imageUrl: string;
  message: string;
  fetchFn?: typeof fetch | undefined;
  baseUrl?: string | undefined;
}

/**
 * Flujo oficial de publicación en Página de Facebook:
 * `POST /{page-id}/photos` con `url` y `message` -> devuelve `externalId` (`post_id || id`).
 */
export async function publishToFacebookPage(
  input: PublishToFacebookInput,
): Promise<{ externalId: string }> {
  const fetchImpl = input.fetchFn ?? fetch;
  const baseUrl = input.baseUrl ?? META_GRAPH_BASE_URL;

  let resp: Response;
  try {
    resp = await fetchImpl(`${baseUrl}/${encodeURIComponent(input.pageId)}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: input.imageUrl,
        message: input.message,
        published: true,
        access_token: input.accessToken,
      }),
    });
  } catch (err) {
    throw new MetaGraphApiError(classifyMetaGraphError(err));
  }

  const body = await parseGraphJsonOrThrow(resp);
  const postId =
    typeof body["post_id"] === "string" && body["post_id"].trim()
      ? body["post_id"].trim()
      : typeof body["id"] === "string"
        ? body["id"].trim()
        : "";

  if (!postId) {
    throw new MetaGraphApiError(
      classifyMetaGraphError({
        error: {
          code: 100,
          message: "Facebook Graph API no devolvió un identificador de publicación.",
        },
      }),
    );
  }

  return { externalId: postId };
}
