import type { Activo } from "@/types";

/** Tiempo de espera tolerante a cold-start en instancias gratuitas de Render. */
export const DEFAULT_API_TIMEOUT_MS = 45_000;

export class ApiRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

/**
 * Resuelve y valida la URL base de la API formal (`VITE_API_URL`).
 * Solo permite `https://`, o `http://` en `localhost`/`127.0.0.1` para desarrollo local.
 */
export function resolveApiBaseUrl(rawUrl?: string | undefined): string | null {
  const candidate =
    rawUrl ??
    (typeof import.meta !== "undefined"
      ? (import.meta.env?.["VITE_API_URL"] as string | undefined)
      : undefined);

  const trimmed = candidate?.trim() ?? "";
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    const isHttps = parsed.protocol === "https:";
    const isLocalHttp =
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");

    if (!isHttps && !isLocalHttp) return null;

    const cleanPath = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${cleanPath}`;
  } catch {
    return null;
  }
}

/**
 * Construye una URL completa hacia un endpoint de la API formal asegurando una sola barra.
 */
export function buildApiEndpointUrl(baseUrl: string, path: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}

/**
 * Construye cabeceras HTTP seguras para llamar a la API formal.
 * Cuando exista sesión de Supabase Auth, adjunta el JWT en `Authorization`.
 */
export function buildApiHeaders(options?: {
  accessToken?: string | undefined;
  hasBody?: boolean | undefined;
}): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (options?.hasBody) {
    headers["Content-Type"] = "application/json";
  }
  const token = options?.accessToken?.trim();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

interface ApiRequestParams {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown> | undefined;
  accessToken?: string | undefined;
  baseUrl?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
}

async function requestApiJson<T>(params: ApiRequestParams): Promise<T> {
  const resolvedBase = resolveApiBaseUrl(params.baseUrl);
  if (!resolvedBase) {
    throw new ApiRequestError(
      0,
      "La URL de la API formal (VITE_API_URL) no está configurada o no usa HTTPS.",
    );
  }

  const fetchFn = params.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeoutMs = params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const hasBody = params.body !== undefined;
    const response = await fetchFn(buildApiEndpointUrl(resolvedBase, params.path), {
      method: params.method,
      headers: buildApiHeaders({ accessToken: params.accessToken, hasBody }),
      ...(hasBody ? { body: JSON.stringify(params.body) } : {}),
      signal: controller.signal,
    });

    const rawText = await response.text();
    let payload: Record<string, unknown> | null = null;
    if (rawText) {
      try {
        payload = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const serverMsg =
        payload && typeof payload["error"] === "string"
          ? payload["error"]
          : `Error HTTP ${response.status} al comunicarse con la API.`;
      throw new ApiRequestError(response.status, serverMsg);
    }

    return (payload ?? {}) as T;
  } catch (err) {
    if (err instanceof ApiRequestError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new ApiRequestError(
        408,
        "La API tardó demasiado en responder (posible inicio en frío de Render). Intenta de nuevo.",
      );
    }
    throw new ApiRequestError(
      0,
      err instanceof Error ? err.message : "No se pudo conectar con la API formal.",
    );
  } finally {
    clearTimeout(timer);
  }
}

export interface CreateAssetApiInput {
  sucursalId: string;
  urlImagen: string;
  tags: string;
  accessToken?: string | undefined;
  baseUrl?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
}

/**
 * Registra un activo multimedia validando sucursal, URL y etiquetas a través de la API formal.
 */
export async function createAssetViaApi(
  input: CreateAssetApiInput,
): Promise<Activo> {
  const data = await requestApiJson<{ activo?: Activo }>({
    method: "POST",
    path: "/api/activos",
    body: {
      sucursal_id: input.sucursalId,
      url_imagen: input.urlImagen,
      tags: input.tags,
    },
    accessToken: input.accessToken,
    baseUrl: input.baseUrl,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
  });

  if (!data.activo) {
    throw new ApiRequestError(
      502,
      "La API formal no devolvió el activo recién creado.",
    );
  }
  return data.activo;
}

export interface CreatePublicationApiInput {
  sucursalId: string;
  activoId: string;
  textoCopy: string;
  fechaPublicacion: string;
  redSocial: "Instagram" | "Facebook";
  accessToken?: string | undefined;
  baseUrl?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
}

/**
 * Agenda una publicación validando reglas negativas de marca y pertenencia de activo en la API formal.
 */
export async function createPublicationViaApi(
  input: CreatePublicationApiInput,
): Promise<Record<string, unknown>> {
  return await requestApiJson<Record<string, unknown>>({
    method: "POST",
    path: "/api/publicaciones",
    body: {
      sucursal_id: input.sucursalId,
      activo_id: input.activoId,
      texto_copy: input.textoCopy,
      fecha_publicacion: input.fechaPublicacion,
      red_social: input.redSocial.toLowerCase(),
    },
    accessToken: input.accessToken,
    baseUrl: input.baseUrl,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
  });
}

/**
 * Lista las publicaciones desde la API formal (`/api/publicaciones`).
 */
export async function fetchPublicationsViaApi(options?: {
  accessToken?: string | undefined;
  baseUrl?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
}): Promise<{ total: number; publicaciones: Record<string, unknown>[] }> {
  const data = await requestApiJson<{
    total?: number;
    publicaciones?: Record<string, unknown>[];
  }>({
    method: "GET",
    path: "/api/publicaciones",
    accessToken: options?.accessToken,
    baseUrl: options?.baseUrl,
    fetchImpl: options?.fetchImpl,
    timeoutMs: options?.timeoutMs,
  });

  const publicaciones = Array.isArray(data.publicaciones) ? data.publicaciones : [];
  return {
    total: typeof data.total === "number" ? data.total : publicaciones.length,
    publicaciones,
  };
}
