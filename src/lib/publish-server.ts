import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import {
  MetaGraphApiError,
  canTransitionPublishStatus,
  checkInstagramDailyQuota,
  classifyMetaGraphError,
  computeRetryBackoff,
  filterDueScheduledPosts,
  isIdempotentSkip,
  isIntegrationTokenExpired,
  isMissingPublishColumnsError,
  normalizePublishStatus,
  publishToFacebookPage,
  publishToInstagramFeed,
  resolveMetaAccountCredentials,
  sanitizeMetaAccessToken,
} from "@/lib/publish";
import type { PublishStatus } from "@/types";

export interface PublishPostInput {
  publicacionId: string;
  explicitRetry?: boolean | undefined;
  fromCron?: boolean | undefined;
}

export interface PublishPostResult {
  ok: boolean;
  publicacionId: string;
  status: PublishStatus;
  skipped?: boolean | undefined;
  externalId?: string | null | undefined;
  publishedAtIso?: string | null | undefined;
  attempts?: number | undefined;
  errorMessage?: string | null | undefined;
  pauseIntegration?: boolean | undefined;
  nextScheduledAtIso?: string | null | undefined;
  assetId?: string | null | undefined;
  assetUses?: number | undefined;
}

export interface CronDispatchSummary {
  ok: boolean;
  processed: number;
  published: number;
  failed: number;
  skipped: number;
  results: PublishPostResult[];
}

function readServerEnv(
  key: string,
  envOverride?: Record<string, unknown>,
): string | undefined {
  if (envOverride && typeof envOverride[key] === "string" && envOverride[key]) {
    return (envOverride[key] as string).trim();
  }
  const globalEnv = (globalThis as Record<string, unknown>)["__env__"];
  if (
    globalEnv &&
    typeof globalEnv === "object" &&
    typeof (globalEnv as Record<string, unknown>)[key] === "string"
  ) {
    const val = ((globalEnv as Record<string, unknown>)[key] as string).trim();
    if (val) return val;
  }
  if (typeof process !== "undefined" && process.env && typeof process.env[key] === "string") {
    const val = process.env[key]?.trim();
    if (val) return val;
  }
  return undefined;
}

function createServerSupabaseClient(
  envOverride?: Record<string, unknown>,
): SupabaseClient {
  const supabaseUrl =
    readServerEnv("SUPABASE_URL", envOverride) ??
    readServerEnv("VITE_SUPABASE_URL", envOverride) ??
    (typeof import.meta !== "undefined" ? import.meta.env?.["VITE_SUPABASE_URL"] : undefined);

  const supabaseKey =
    readServerEnv("SUPABASE_SERVICE_ROLE_KEY", envOverride) ??
    readServerEnv("SUPABASE_ANON_KEY", envOverride) ??
    readServerEnv("VITE_SUPABASE_PUBLISHABLE_KEY", envOverride) ??
    readServerEnv("VITE_SUPABASE_ANON_KEY", envOverride) ??
    (typeof import.meta !== "undefined"
      ? import.meta.env?.["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
        import.meta.env?.["VITE_SUPABASE_ANON_KEY"]
      : undefined);

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Faltan las credenciales de Supabase en el servidor (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).",
    );
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

interface RawPostRow {
  id: string;
  sucursal_id: string;
  texto_copy: string;
  fecha_publicacion: string;
  red_social: string;
  estado: string;
  activo_id?: string | null | undefined;
  ultimo_error?: string | null | undefined;
  intentos?: number | null | undefined;
  publicado_en?: string | null | undefined;
  id_externo?: string | null | undefined;
  activos?:
    | {
        id?: string | undefined;
        url_imagen?: string | undefined;
        contador_uso?: number | null | undefined;
      }
    | null
    | undefined;
}

interface RawIntegrationRow {
  id: string;
  sucursal_id: string;
  plataforma: string;
  token_cifrado: string | null;
  page_id?: string | null | undefined;
  ig_user_id?: string | null | undefined;
  token_expira_en?: string | null | undefined;
}

async function fetchPostWithFallback(
  supabase: SupabaseClient,
  publicacionId: string,
): Promise<{ row: RawPostRow | null; hasExtendedColumns: boolean }> {
  const extendedRes = await supabase
    .from("publicaciones")
    .select(
      `
      id,
      sucursal_id,
      texto_copy,
      fecha_publicacion,
      red_social,
      estado,
      activo_id,
      ultimo_error,
      intentos,
      publicado_en,
      id_externo,
      activos (id, url_imagen, contador_uso)
    `,
    )
    .eq("id", publicacionId)
    .maybeSingle();

  if (!extendedRes.error) {
    return {
      row: (extendedRes.data as unknown as RawPostRow | null) ?? null,
      hasExtendedColumns: true,
    };
  }

  if (isMissingPublishColumnsError(extendedRes.error)) {
    const basicRes = await supabase
      .from("publicaciones")
      .select(
        `
        id,
        sucursal_id,
        texto_copy,
        fecha_publicacion,
        red_social,
        estado,
        activo_id,
        activos (id, url_imagen, contador_uso)
      `,
      )
      .eq("id", publicacionId)
      .maybeSingle();

    if (basicRes.error) {
      throw new Error(`Error leyendo publicación: ${basicRes.error.message}`);
    }

    return {
      row: (basicRes.data as unknown as RawPostRow | null) ?? null,
      hasExtendedColumns: false,
    };
  }

  throw new Error(`Error leyendo publicación: ${extendedRes.error.message}`);
}

async function updatePostWithFallback(
  supabase: SupabaseClient,
  publicacionId: string,
  extendedPayload: Record<string, unknown>,
  fallbackPayload: Record<string, unknown>,
): Promise<void> {
  const res = await supabase
    .from("publicaciones")
    .update(extendedPayload)
    .eq("id", publicacionId);

  if (res.error && isMissingPublishColumnsError(res.error)) {
    await supabase
      .from("publicaciones")
      .update(fallbackPayload)
      .eq("id", publicacionId);
  }
}

/**
 * Ejecuta el flujo completo de publicación en Meta Graph API desde el servidor.
 * Nunca expone el token al cliente.
 */
export async function publishPostOnServer(
  input: PublishPostInput,
  envOverride?: Record<string, unknown>,
  fetchFn?: typeof fetch,
): Promise<PublishPostResult> {
  const publicacionId = input.publicacionId.trim();
  if (!publicacionId) {
    return {
      ok: false,
      publicacionId: "",
      status: "error",
      errorMessage: "El identificador de la publicación es obligatorio.",
    };
  }

  const supabase = createServerSupabaseClient(envOverride);
  const now = new Date();
  const nowIso = now.toISOString();

  const { row: post } = await fetchPostWithFallback(supabase, publicacionId);
  if (!post) {
    return {
      ok: false,
      publicacionId,
      status: "error",
      errorMessage: "No se encontró la publicación solicitada en Supabase.",
    };
  }

  let currentStatus = normalizePublishStatus(post.estado);
  const currentAttempts = typeof post.intentos === "number" ? post.intentos : 0;

  // Si viene desde el botón "Reintentar" en estado 'error', validamos y pasamos a 'programado'
  if (currentStatus === "error" && input.explicitRetry === true) {
    const retryTransition = canTransitionPublishStatus("error", "programado", {
      explicitRetry: true,
      hasExternalId: Boolean(post.id_externo),
    });
    if (!retryTransition.valid) {
      return {
        ok: false,
        publicacionId,
        status: currentStatus,
        errorMessage: retryTransition.reason ?? "No se puede reintentar esta publicación.",
      };
    }

    await updatePostWithFallback(
      supabase,
      publicacionId,
      { estado: "programado", ultimo_error: null },
      { estado: "programado" },
    );
    post.estado = "programado";
    currentStatus = "programado";
  }

  // Idempotencia: si ya tiene id_externo o no está en 'programado', no reenviar
  const idempotency = isIdempotentSkip({
    estado: post.estado,
    id_externo: post.id_externo,
  });
  if (idempotency.skip) {
    return {
      ok: currentStatus === "publicado",
      publicacionId,
      status: currentStatus,
      skipped: true,
      externalId: post.id_externo ?? null,
      publishedAtIso: post.publicado_en ?? null,
      attempts: currentAttempts,
      errorMessage: currentStatus === "publicado" ? null : idempotency.reason,
    };
  }

  const network: "Instagram" | "Facebook" =
    post.red_social?.trim().toLowerCase() === "facebook" ? "Facebook" : "Instagram";

  // Verificar cuota de 25 publicaciones / 24h para Instagram antes de reclamar
  if (network === "Instagram") {
    const branchPostsRes = await supabase
      .from("publicaciones")
      .select("id, red_social, estado, fecha_publicacion, publicado_en")
      .eq("sucursal_id", post.sucursal_id);

    const branchPosts = Array.isArray(branchPostsRes.data)
      ? (branchPostsRes.data as Array<{
          red_social?: string;
          estado?: string;
          fecha_publicacion?: string | null;
          publicado_en?: string | null;
        }>)
      : [];

    const quota = checkInstagramDailyQuota(branchPosts, now);
    if (!quota.allowed) {
      const quotaMsg =
        quota.reason ??
        "Se alcanzó el límite de 25 publicaciones en 24 horas para esta cuenta de Instagram.";
      await updatePostWithFallback(
        supabase,
        publicacionId,
        { estado: "error", ultimo_error: quotaMsg },
        { estado: "error" },
      );
      return {
        ok: false,
        publicacionId,
        status: "error",
        attempts: currentAttempts,
        errorMessage: quotaMsg,
      };
    }
  }

  // Leer integración social de la sucursal
  const integrationsRes = await supabase
    .from("integraciones_sociales")
    .select("*")
    .eq("sucursal_id", post.sucursal_id);

  const integrations = Array.isArray(integrationsRes.data)
    ? (integrationsRes.data as unknown as RawIntegrationRow[])
    : [];
  const metaIntegration =
    integrations.find((i) => i.plataforma === "Instagram_Graph_API") ?? integrations[0];

  const rawEnvToken = readServerEnv("META_PAGE_ACCESS_TOKEN", envOverride);
  const envToken = rawEnvToken ? sanitizeMetaAccessToken(rawEnvToken) : undefined;
  const rawDbToken =
    metaIntegration?.token_cifrado &&
    !String(metaIntegration.token_cifrado).startsWith("token_")
      ? metaIntegration.token_cifrado
      : undefined;
  const dbToken = rawDbToken ? sanitizeMetaAccessToken(rawDbToken) : undefined;

  if (metaIntegration && isIntegrationTokenExpired(metaIntegration, now) && !envToken) {
    const expiredMsg =
      "La integración con Meta está pausada porque el token expiró (código 190). Renueva el token en Ajustes → Integraciones.";
    await updatePostWithFallback(
      supabase,
      publicacionId,
      { estado: "error", ultimo_error: expiredMsg },
      { estado: "error" },
    );
    return {
      ok: false,
      publicacionId,
      status: "error",
      attempts: currentAttempts,
      pauseIntegration: true,
      errorMessage: expiredMsg,
    };
  }

  const useDbToken =
    Boolean(dbToken) && (!metaIntegration || !isIntegrationTokenExpired(metaIntegration, now));
  const accessToken = useDbToken ? dbToken : (envToken || dbToken);
  const tokenSource = useDbToken
    ? "integraciones_sociales"
    : envToken
      ? "META_PAGE_ACCESS_TOKEN"
      : "ninguno";
  if (!accessToken) {
    const missingTokenMsg =
      "No hay un token de Meta configurado. Define el secret META_PAGE_ACCESS_TOKEN en el servidor o guarda un token real en integraciones_sociales.";
    await updatePostWithFallback(
      supabase,
      publicacionId,
      { estado: "error", ultimo_error: missingTokenMsg },
      { estado: "error" },
    );
    return {
      ok: false,
      publicacionId,
      status: "error",
      attempts: currentAttempts,
      errorMessage: missingTokenMsg,
    };
  }

  const imageUrl = post.activos?.url_imagen?.trim() ?? "";
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
    const missingImgMsg =
      "La publicación no tiene una URL pública de imagen válida en el bucket 'galeria'.";
    await updatePostWithFallback(
      supabase,
      publicacionId,
      { estado: "error", ultimo_error: missingImgMsg },
      { estado: "error" },
    );
    return {
      ok: false,
      publicacionId,
      status: "error",
      attempts: currentAttempts,
      errorMessage: missingImgMsg,
    };
  }

  // Claim atómico (programado -> publicando) para evitar doble envío concurrente
  const claimRes = await supabase
    .from("publicaciones")
    .update({ estado: "publicando" })
    .eq("id", publicacionId)
    .eq("estado", "programado")
    .select("id");

  if (claimRes.error || !Array.isArray(claimRes.data) || claimRes.data.length === 0) {
    return {
      ok: false,
      publicacionId,
      status: "publicando",
      skipped: true,
      attempts: currentAttempts,
      errorMessage: "La publicación ya fue reclamada por otro proceso en curso.",
    };
  }

  try {
    const configuredPageId =
      metaIntegration?.page_id ?? readServerEnv("META_PAGE_ID", envOverride);
    const configuredIgUserId =
      metaIntegration?.ig_user_id ?? readServerEnv("META_IG_USER_ID", envOverride);

    const credentials = await resolveMetaAccountCredentials({
      accessToken,
      network,
      pageId: configuredPageId,
      igUserId: configuredIgUserId,
      fetchFn,
    });

    // Cachear page_id e ig_user_id en integraciones_sociales si no estaban guardados
    if (
      metaIntegration &&
      (!metaIntegration.page_id || (network === "Instagram" && !metaIntegration.ig_user_id))
    ) {
      await supabase
        .from("integraciones_sociales")
        .update({
          page_id: credentials.pageId,
          ig_user_id: credentials.igUserId ?? metaIntegration.ig_user_id ?? null,
        })
        .eq("id", metaIntegration.id);
    }

    let externalId: string;
    if (network === "Instagram") {
      const igResult = await publishToInstagramFeed({
        igUserId: credentials.igUserId!,
        accessToken: credentials.pageAccessToken,
        imageUrl,
        caption: post.texto_copy,
        fetchFn,
      });
      externalId = igResult.externalId;
    } else {
      const fbResult = await publishToFacebookPage({
        pageId: credentials.pageId,
        accessToken: credentials.pageAccessToken,
        imageUrl,
        message: post.texto_copy,
        fetchFn,
      });
      externalId = fbResult.externalId;
    }

    // Éxito: actualizar estado a 'publicado' + guardar publicado_en e id_externo
    await updatePostWithFallback(
      supabase,
      publicacionId,
      {
        estado: "publicado",
        publicado_en: nowIso,
        id_externo: externalId,
        ultimo_error: null,
        intentos: currentAttempts + 1,
      },
      { estado: "publicado" },
    );

    // Incrementar contador_uso del activo vinculado
    let nextAssetUses: number | undefined;
    const assetId = post.activo_id ?? post.activos?.id;
    if (assetId) {
      const currentUses =
        typeof post.activos?.contador_uso === "number" ? post.activos.contador_uso : 0;
      nextAssetUses = currentUses + 1;
      await supabase
        .from("activos")
        .update({ contador_uso: nextAssetUses })
        .eq("id", String(assetId));
    }

    return {
      ok: true,
      publicacionId,
      status: "publicado",
      externalId,
      publishedAtIso: nowIso,
      attempts: currentAttempts + 1,
      errorMessage: null,
      assetId: assetId ? String(assetId) : null,
      assetUses: nextAssetUses,
    };
  } catch (err) {
    const classified =
      err instanceof MetaGraphApiError
        ? err.classified
        : classifyMetaGraphError(err);
    const retryDecision = computeRetryBackoff(currentAttempts, classified, now);

    // Si es error 190, marcamos la integración como expirada para pausar inmediatamente
    if (retryDecision.pauseIntegration && metaIntegration) {
      await supabase
        .from("integraciones_sociales")
        .update({ token_expira_en: nowIso })
        .eq("id", metaIntegration.id);
    }

    // Si viene del cron automático y el error es recuperable dentro del tope de intentos,
    // reprogramamos con backoff (1m / 5m / 15m) en estado 'programado'.
    if (input.fromCron === true && retryDecision.shouldRetry && retryDecision.nextScheduledAtIso) {
      await updatePostWithFallback(
        supabase,
        publicacionId,
        {
          estado: "programado",
          fecha_publicacion: retryDecision.nextScheduledAtIso,
          intentos: retryDecision.nextAttempt,
          ultimo_error: `${classified.userMessage} (${retryDecision.reason})`,
        },
        {
          estado: "programado",
          fecha_publicacion: retryDecision.nextScheduledAtIso,
        },
      );

      return {
        ok: false,
        publicacionId,
        status: "programado",
        attempts: retryDecision.nextAttempt,
        errorMessage: classified.userMessage,
        pauseIntegration: retryDecision.pauseIntegration,
        nextScheduledAtIso: retryDecision.nextScheduledAtIso,
      };
    }

    const diagnosticSuffix =
      classified.code === 2500 || classified.code === 190
        ? ` [Fuente: ${tokenSource}, longitud: ${accessToken.length} caracteres${accessToken.includes("|") ? ", formato App Token '|'" : ""}]`
        : "";
    const finalErrorMessage = `${classified.userMessage}${diagnosticSuffix}`;

    await updatePostWithFallback(
      supabase,
      publicacionId,
      {
        estado: "error",
        intentos: retryDecision.nextAttempt,
        ultimo_error: finalErrorMessage,
      },
      { estado: "error" },
    );

    return {
      ok: false,
      publicacionId,
      status: "error",
      attempts: retryDecision.nextAttempt,
      errorMessage: finalErrorMessage,
      pauseIntegration: retryDecision.pauseIntegration,
    };
  }
}

/**
 * Worker de despacho por lotes (ejecutado cada minuto por Cron Trigger o pg_cron):
 * busca todas las publicaciones con `estado = 'programado'` y `fecha_publicacion <= now()`
 * y las despacha secuencialmente con claim atómico.
 */
export async function publishDuePostsOnServer(
  envOverride?: Record<string, unknown>,
  fetchFn?: typeof fetch,
): Promise<CronDispatchSummary> {
  const supabase = createServerSupabaseClient(envOverride);
  const now = new Date();
  const nowIso = now.toISOString();

  const extendedQuery = await supabase
    .from("publicaciones")
    .select("id, estado, fecha_publicacion, id_externo")
    .eq("estado", "programado")
    .lte("fecha_publicacion", nowIso)
    .order("fecha_publicacion", { ascending: true })
    .limit(15);

  let rows: Array<{
    id: string;
    estado: string;
    fecha_publicacion: string;
    id_externo?: string | null | undefined;
  }> = [];

  if (!extendedQuery.error && Array.isArray(extendedQuery.data)) {
    rows = extendedQuery.data as typeof rows;
  } else if (isMissingPublishColumnsError(extendedQuery.error)) {
    const basicQuery = await supabase
      .from("publicaciones")
      .select("id, estado, fecha_publicacion")
      .eq("estado", "programado")
      .lte("fecha_publicacion", nowIso)
      .order("fecha_publicacion", { ascending: true })
      .limit(15);
    if (Array.isArray(basicQuery.data)) {
      rows = basicQuery.data as typeof rows;
    }
  }

  const duePosts = filterDueScheduledPosts(rows, now);
  const results: PublishPostResult[] = [];

  for (const due of duePosts) {
    const res = await publishPostOnServer(
      {
        publicacionId: due.id,
        fromCron: true,
      },
      envOverride,
      fetchFn,
    );
    results.push(res);
  }

  return {
    ok: true,
    processed: results.length,
    published: results.filter((r) => r.status === "publicado" && !r.skipped).length,
    failed: results.filter((r) => !r.ok && !r.skipped).length,
    skipped: results.filter((r) => Boolean(r.skipped)).length,
    results,
  };
}

/**
 * Server Function de TanStack Start para invocar `publishPost` desde el cliente
 * sin exponer el token de Meta en el bundle del navegador.
 */
export const publishPostServerFn = createServerFn({ method: "POST" })
  .validator((data: PublishPostInput) => {
    if (!data || typeof data.publicacionId !== "string" || !data.publicacionId.trim()) {
      throw new Error("Se requiere un publicacionId válido.");
    }
    return {
      publicacionId: data.publicacionId.trim(),
      explicitRetry: Boolean(data.explicitRetry),
    };
  })
  .handler(async ({ data }): Promise<PublishPostResult> => {
    try {
      return await publishPostOnServer({
        publicacionId: data.publicacionId,
        explicitRetry: data.explicitRetry,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Error inesperado en el servidor al publicar en Meta.";
      return {
        ok: false,
        publicacionId: data.publicacionId,
        status: "error",
        errorMessage: message,
      };
    }
  });

export interface SyncMetaIntegrationInput {
  sucursalId: string;
  pageId?: string | undefined;
  igUserId?: string | undefined;
}

export interface SyncMetaIntegrationResult {
  ok: boolean;
  pageId?: string | null | undefined;
  igUserId?: string | null | undefined;
  errorMessage?: string | undefined;
}

/**
 * Server Function para verificar el secret `META_PAGE_ACCESS_TOKEN` en el servidor,
 * resolver o guardar `page_id` e `ig_user_id` en `integraciones_sociales` y reactivar la integración.
 */
export const syncMetaIntegrationServerFn = createServerFn({ method: "POST" })
  .validator((data: SyncMetaIntegrationInput) => {
    if (!data || typeof data.sucursalId !== "string" || !data.sucursalId.trim()) {
      throw new Error("Se requiere un sucursalId válido.");
    }
    return {
      sucursalId: data.sucursalId.trim(),
      pageId: data.pageId?.trim() || undefined,
      igUserId: data.igUserId?.trim() || undefined,
    };
  })
  .handler(async ({ data }): Promise<SyncMetaIntegrationResult> => {
    try {
      const supabase = createServerSupabaseClient();
      const existingRes = await supabase
        .from("integraciones_sociales")
        .select("*")
        .eq("sucursal_id", data.sucursalId)
        .maybeSingle();

      const existing = existingRes.data as RawIntegrationRow | null;
      const rawEnvToken = readServerEnv("META_PAGE_ACCESS_TOKEN");
      const envToken = rawEnvToken ? sanitizeMetaAccessToken(rawEnvToken) : undefined;
      const rawDbToken =
        existing?.token_cifrado && !String(existing.token_cifrado).startsWith("token_")
          ? existing.token_cifrado
          : undefined;
      const dbToken = rawDbToken ? sanitizeMetaAccessToken(rawDbToken) : undefined;
      const accessToken = envToken ?? dbToken;

      let resolvedPageId =
        data.pageId ?? existing?.page_id ?? readServerEnv("META_PAGE_ID");
      let resolvedIgUserId =
        data.igUserId ?? existing?.ig_user_id ?? readServerEnv("META_IG_USER_ID");

      if (accessToken && (!resolvedPageId || !resolvedIgUserId)) {
        const creds = await resolveMetaAccountCredentials({
          accessToken,
          network: resolvedIgUserId ? "Facebook" : "Instagram",
          pageId: resolvedPageId,
          igUserId: resolvedIgUserId,
        });
        resolvedPageId = creds.pageId;
        resolvedIgUserId = creds.igUserId ?? resolvedIgUserId;
      }

      if (!resolvedPageId && !accessToken) {
        return {
          ok: false,
          errorMessage:
            "No se encontró el secret META_PAGE_ACCESS_TOKEN en el servidor ni un Page ID manual.",
        };
      }

      if (existing) {
        await supabase
          .from("integraciones_sociales")
          .update({
            page_id: resolvedPageId ?? null,
            ig_user_id: resolvedIgUserId ?? null,
            token_expira_en: null,
          })
          .eq("id", existing.id);
      } else {
        await supabase.from("integraciones_sociales").insert([
          {
            sucursal_id: data.sucursalId,
            plataforma: "Instagram_Graph_API",
            token_cifrado: null,
            page_id: resolvedPageId ?? null,
            ig_user_id: resolvedIgUserId ?? null,
            token_expira_en: null,
          },
        ]);
      }

      return {
        ok: true,
        pageId: resolvedPageId ?? null,
        igUserId: resolvedIgUserId ?? null,
      };
    } catch (err) {
      const classified =
        err instanceof MetaGraphApiError ? err.classified : classifyMetaGraphError(err);
      return {
        ok: false,
        errorMessage: classified.userMessage,
      };
    }
  });
