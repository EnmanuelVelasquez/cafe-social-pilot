import { describe, expect, it, vi } from "vitest";
import {
  BACKOFF_DELAYS_MS,
  MAX_PUBLISH_ATTEMPTS,
  META_IG_DAILY_PUBLISH_LIMIT,
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
} from "@/lib/publish";
import type { PublishStatus } from "@/types";

describe("Etapa 4 · Máquina de estados de publicación e idempotencia (src/lib/publish.ts)", () => {
  it("normaliza variantes de texto al estado canónico", () => {
    expect(normalizePublishStatus("pendiente")).toBe("pendiente");
    expect(normalizePublishStatus("PROGRAMADO")).toBe("programado");
    expect(normalizePublishStatus("programada")).toBe("programado");
    expect(normalizePublishStatus("publicando")).toBe("publicando");
    expect(normalizePublishStatus("publicado")).toBe("publicado");
    expect(normalizePublishStatus("publicada")).toBe("publicado");
    expect(normalizePublishStatus("error")).toBe("error");
    expect(normalizePublishStatus("fallido")).toBe("error");
    expect(normalizePublishStatus("")).toBe("pendiente");
  });

  it.each<{
    from: string;
    to: PublishStatus;
    explicitRetry?: boolean;
    hasExternalId?: boolean;
    expected: boolean;
  }>([
    { from: "pendiente", to: "programado", expected: true },
    { from: "programado", to: "publicando", expected: true },
    { from: "publicando", to: "publicado", expected: true },
    { from: "publicando", to: "error", expected: true },
    { from: "error", to: "programado", explicitRetry: true, expected: true },
    // Transiciones inválidas
    { from: "error", to: "programado", explicitRetry: false, expected: false },
    { from: "error", to: "programado", expected: false },
    { from: "pendiente", to: "publicando", expected: false },
    { from: "pendiente", to: "publicado", expected: false },
    { from: "programado", to: "publicado", expected: false },
    { from: "publicado", to: "programado", explicitRetry: true, expected: false },
    { from: "publicado", to: "publicando", expected: false },
    { from: "publicado", to: "error", expected: false },
    { from: "programado", to: "publicando", hasExternalId: true, expected: false },
  ])(
    "valida transición $from -> $to (explicitRetry=$explicitRetry, hasExternalId=$hasExternalId) => $expected",
    ({ from, to, explicitRetry, hasExternalId, expected }) => {
      const result = canTransitionPublishStatus(from, to, {
        explicitRetry,
        hasExternalId,
      });
      expect(result.valid).toBe(expected);
      if (!expected) {
        expect(result.reason).toBeTruthy();
      }
    },
  );

  it("aplica idempotencia cuando id_externo ya existe o el estado no es programado", () => {
    expect(
      isIdempotentSkip({ estado: "programado", id_externo: "17895695668004550" }),
    ).toEqual({
      skip: true,
      reason: expect.stringContaining("17895695668004550"),
    });

    expect(isIdempotentSkip({ estado: "publicado", id_externo: null })).toEqual({
      skip: true,
      reason: expect.stringContaining("publicado"),
    });

    expect(isIdempotentSkip({ estado: "publicando", id_externo: null })).toEqual({
      skip: true,
      reason: expect.stringContaining("publicando"),
    });

    expect(isIdempotentSkip({ estado: "pendiente", id_externo: null })).toEqual({
      skip: true,
      reason: expect.stringContaining("pendiente"),
    });

    expect(isIdempotentSkip({ estado: "programado", id_externo: null })).toEqual({
      skip: false,
    });
  });
});

describe("Etapa 4 · Clasificador de errores de Meta Graph API y política de Backoff", () => {
  it.each([
    {
      name: "Código 190 (token expirado/inválido)",
      payload: {
        error: {
          message: "Error validating access token: Session has expired",
          type: "OAuthException",
          code: 190,
          error_subcode: 463,
        },
      },
      httpStatus: 401,
      expectedCategory: "TOKEN_EXPIRED",
      expectedRetryable: false,
      expectedPause: true,
    },
    {
      name: "Código 4 (App rate limit)",
      payload: {
        error: {
          message: "Application request limit reached",
          code: 4,
        },
      },
      httpStatus: 400,
      expectedCategory: "RATE_LIMIT",
      expectedRetryable: true,
      expectedPause: false,
    },
    {
      name: "Código 17 (User request limit)",
      payload: {
        error: {
          message: "User request limit reached",
          code: 17,
        },
      },
      httpStatus: 400,
      expectedCategory: "RATE_LIMIT",
      expectedRetryable: true,
      expectedPause: false,
    },
    {
      name: "Código 613 (Calls to this api have exceeded the rate limit)",
      payload: {
        error: {
          message: "Calls to this api have exceeded the rate limit.",
          code: 613,
        },
      },
      httpStatus: 429,
      expectedCategory: "RATE_LIMIT",
      expectedRetryable: true,
      expectedPause: false,
    },
    {
      name: "Código 200 (Permisos faltantes)",
      payload: {
        error: {
          message: "(#200) Requires instagram_content_publish permission",
          code: 200,
        },
      },
      httpStatus: 403,
      expectedCategory: "PERMISSION_DENIED",
      expectedRetryable: false,
      expectedPause: false,
    },
    {
      name: "Código 100 (Parámetro o imagen inválida)",
      payload: {
        error: {
          message: "Invalid parameter",
          code: 100,
          error_subcode: 2207009,
          error_user_msg: "The aspect ratio is not supported.",
        },
      },
      httpStatus: 400,
      expectedCategory: "INVALID_MEDIA_OR_PARAM",
      expectedRetryable: false,
      expectedPause: false,
    },
    {
      name: "Código 9007 (Contenedor de IG aún no disponible)",
      payload: {
        error: {
          message: "Media ID is not available",
          code: 9007,
        },
      },
      httpStatus: 400,
      expectedCategory: "IG_CONTAINER_ERROR",
      expectedRetryable: true,
      expectedPause: false,
    },
    {
      name: "HTTP 503 (Fallo temporal de Meta)",
      payload: {
        error: {
          message: "Service temporarily unavailable",
          code: 2,
        },
      },
      httpStatus: 503,
      expectedCategory: "TRANSIENT",
      expectedRetryable: true,
      expectedPause: false,
    },
  ])(
    "clasifica correctamente: $name",
    ({ payload, httpStatus, expectedCategory, expectedRetryable, expectedPause }) => {
      const classified = classifyMetaGraphError(payload, httpStatus);
      expect(classified.category).toBe(expectedCategory);
      expect(classified.retryable).toBe(expectedRetryable);
      expect(classified.pauseIntegration).toBe(expectedPause);
      expect(classified.userMessage.length).toBeGreaterThan(15);
    },
  );

  it("aplica backoff 1m -> 5m -> 15m y corta al superar MAX_PUBLISH_ATTEMPTS (3)", () => {
    const now = new Date("2026-11-09T12:00:00.000Z");
    const rateLimitError = classifyMetaGraphError({
      error: { code: 613, message: "Rate limit" },
    });

    // Intento 1 (currentAttempts = 0) -> 1 min (60_000 ms)
    const r1 = computeRetryBackoff(0, rateLimitError, now);
    expect(r1.shouldRetry).toBe(true);
    expect(r1.nextAttempt).toBe(1);
    expect(r1.delayMs).toBe(BACKOFF_DELAYS_MS[0]);
    expect(r1.nextScheduledAtIso).toBe("2026-11-09T12:01:00.000Z");

    // Intento 2 (currentAttempts = 1) -> 5 min (300_000 ms)
    const r2 = computeRetryBackoff(1, rateLimitError, now);
    expect(r2.shouldRetry).toBe(true);
    expect(r2.nextAttempt).toBe(2);
    expect(r2.delayMs).toBe(BACKOFF_DELAYS_MS[1]);
    expect(r2.nextScheduledAtIso).toBe("2026-11-09T12:05:00.000Z");

    // Intento 3 (currentAttempts = 2) -> 15 min (900_000 ms)
    const r3 = computeRetryBackoff(2, rateLimitError, now);
    expect(r3.shouldRetry).toBe(true);
    expect(r3.nextAttempt).toBe(3);
    expect(r3.delayMs).toBe(BACKOFF_DELAYS_MS[2]);
    expect(r3.nextScheduledAtIso).toBe("2026-11-09T12:15:00.000Z");

    // Intento 4 (currentAttempts = 3) -> agotado
    const r4 = computeRetryBackoff(MAX_PUBLISH_ATTEMPTS, rateLimitError, now);
    expect(r4.shouldRetry).toBe(false);
    expect(r4.nextAttempt).toBe(4);
    expect(r4.pauseIntegration).toBe(false);
  });

  it("pausa inmediatamente y nunca reintenta cuando Meta devuelve error 190", () => {
    const tokenError = classifyMetaGraphError({
      error: { code: 190, message: "Invalid OAuth access token." },
    });
    const decision = computeRetryBackoff(0, tokenError);
    expect(decision.shouldRetry).toBe(false);
    expect(decision.pauseIntegration).toBe(true);
    expect(decision.reason).toContain("190");
  });
});

describe("Etapa 4 · Límite de 25 publicaciones / 24h en Instagram y cola de despacho", () => {
  it("permite publicar hasta 24 posts en 24h y bloquea el 26º cuando ya hay 25 publicados en IG", () => {
    const now = new Date("2026-11-09T18:00:00.000Z");
    const recentIso = new Date(now.getTime() - 2 * 3600 * 1000).toISOString();
    const olderThan24hIso = new Date(now.getTime() - 26 * 3600 * 1000).toISOString();

    const twentyFourIgPosts = Array.from({ length: 24 }, (_, idx) => ({
      red_social: "Instagram",
      estado: "publicado",
      publicado_en: recentIso,
      id: `ig-${idx}`,
    }));

    const extraIgnoredPosts = [
      // Facebook no consume cuota de IG
      { red_social: "Facebook", estado: "publicado", publicado_en: recentIso },
      // Publicado hace 26 horas (fuera de ventana de 24h)
      { red_social: "Instagram", estado: "publicado", publicado_en: olderThan24hIso },
      // Programado (aún no publicado)
      { red_social: "Instagram", estado: "programado", fecha_publicacion: recentIso },
    ];

    const check24 = checkInstagramDailyQuota(
      [...twentyFourIgPosts, ...extraIgnoredPosts],
      now,
    );
    expect(check24.allowed).toBe(true);
    expect(check24.publishedLast24h).toBe(24);
    expect(check24.remaining).toBe(1);

    const twentyFiveIgPosts = [
      ...twentyFourIgPosts,
      { red_social: "Instagram", estado: "publicado", publicado_en: recentIso },
    ];
    const check25 = checkInstagramDailyQuota(twentyFiveIgPosts, now);
    expect(check25.allowed).toBe(false);
    expect(check25.publishedLast24h).toBe(META_IG_DAILY_PUBLISH_LIMIT);
    expect(check25.remaining).toBe(0);
    expect(check25.reason).toContain("25");
  });

  it("filtra únicamente publicaciones programadas cuya fecha_publicacion <= now y sin id_externo", () => {
    const now = new Date("2026-11-09T15:00:00.000Z");
    const list = [
      {
        id: "post-future",
        estado: "programado",
        fecha_publicacion: "2026-11-09T15:05:00.000Z",
        id_externo: null,
      },
      {
        id: "post-due-2",
        estado: "programado",
        fecha_publicacion: "2026-11-09T14:59:00.000Z",
        id_externo: null,
      },
      {
        id: "post-due-1",
        estado: "programado",
        fecha_publicacion: "2026-11-09T14:30:00.000Z",
        id_externo: null,
      },
      {
        id: "post-already-sent",
        estado: "programado",
        fecha_publicacion: "2026-11-09T14:00:00.000Z",
        id_externo: "ext-123",
      },
      {
        id: "post-pending",
        estado: "pendiente",
        fecha_publicacion: "2026-11-09T14:00:00.000Z",
        id_externo: null,
      },
    ];

    const due = filterDueScheduledPosts(list, now);
    expect(due.map((p) => p.id)).toEqual(["post-due-1", "post-due-2"]);
  });

  it("detecta expiración de token y errores de columnas pendientes de migración", () => {
    const now = new Date("2026-11-09T15:00:00.000Z");
    expect(
      isIntegrationTokenExpired({ token_expira_en: "2026-11-09T14:59:59.000Z" }, now),
    ).toBe(true);
    expect(
      isIntegrationTokenExpired({ token_expira_en: "2026-11-09T16:00:00.000Z" }, now),
    ).toBe(false);
    expect(isIntegrationTokenExpired({ token_expira_en: null }, now)).toBe(false);

    expect(
      isMissingPublishColumnsError({
        code: "PGRST204",
        message: "Could not find the 'ultimo_error' column of 'publicaciones' in the schema cache",
      }),
    ).toBe(true);
    expect(
      isMissingPublishColumnsError({
        code: "23505",
        message: "duplicate key value violates unique constraint",
      }),
    ).toBe(false);
  });
});

describe("Etapa 4 · Flujo HTTP de Meta Graph API (Instagram y Facebook con fetch inyectado)", () => {
  it("resuelve page_id e ig_user_id desde /me/accounts cuando no están cacheados en BD", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "page-999",
              name: "Mi Negocio",
              access_token: "page-token-xyz",
              instagram_business_account: { id: "ig-888" },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const creds = await resolveMetaAccountCredentials({
      accessToken: "user-token-abc",
      network: "Instagram",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(creds).toEqual({
      pageId: "page-999",
      pageAccessToken: "page-token-xyz",
      igUserId: "ig-888",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("ejecuta el flujo de Instagram: crear contenedor -> esperar FINISHED -> media_publish", async () => {
    const responses = [
      // 1. POST /{ig-user-id}/media
      new Response(JSON.stringify({ id: "container-101" }), { status: 200 }),
      // 2. GET /{creation-id}?fields=status_code (primero IN_PROGRESS)
      new Response(JSON.stringify({ status_code: "IN_PROGRESS" }), { status: 200 }),
      // 3. GET /{creation-id}?fields=status_code (luego FINISHED)
      new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 }),
      // 4. POST /{ig-user-id}/media_publish
      new Response(JSON.stringify({ id: "ig-media-555" }), { status: 200 }),
    ];

    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(responses.shift()!),
    );

    const result = await publishToInstagramFeed({
      igUserId: "ig-888",
      accessToken: "page-token-xyz",
      imageUrl: "https://example.supabase.co/storage/v1/object/public/galeria/img1.jpg",
      caption: "Texto de prueba #marca",
      fetchFn: mockFetch as unknown as typeof fetch,
      pollIntervalMs: 0,
    });

    expect(result).toEqual({
      creationId: "container-101",
      externalId: "ig-media-555",
    });
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("lanza MetaGraphApiError clasificado si el contenedor de Instagram devuelve status_code=ERROR", async () => {
    const responses = [
      new Response(JSON.stringify({ id: "container-err" }), { status: 200 }),
      new Response(
        JSON.stringify({ status_code: "ERROR", status: "Media download failed" }),
        { status: 200 },
      ),
    ];
    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(responses.shift()!),
    );

    await expect(
      publishToInstagramFeed({
        igUserId: "ig-888",
        accessToken: "page-token-xyz",
        imageUrl: "https://example.supabase.co/storage/v1/object/public/galeria/img1.jpg",
        caption: "Texto de prueba",
        fetchFn: mockFetch as unknown as typeof fetch,
        pollIntervalMs: 0,
      }),
    ).rejects.toBeInstanceOf(MetaGraphApiError);
  });

  it("ejecuta el flujo de Facebook: POST /{page-id}/photos y retorna post_id", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ id: "photo-111", post_id: "page-999_post-222" }),
        { status: 200 },
      ),
    );

    const result = await publishToFacebookPage({
      pageId: "page-999",
      accessToken: "page-token-xyz",
      imageUrl: "https://example.supabase.co/storage/v1/object/public/galeria/img1.jpg",
      message: "Publicación en Facebook",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result).toEqual({ externalId: "page-999_post-222" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
