import { buildBrandSystemPrompt, type Pillar } from "@/lib/brand";
import { inferTagsFromFilename, type Asset } from "@/lib/data";
import type { Sucursal } from "@/types";

export type AIPostType = "FEED_SINGLE" | "FEED_CAROUSEL" | "STORY";
export type AIProviderSource = "gemini" | "webhook";
export type VisionTagSource = "gemini" | "webhook" | "filename_fallback";

export const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash";
export const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const RETIRED_GEMINI_MODELS = new Set([
  "gemini-1.5-flash",
  "gemini-2.0-flash",
  "gemini-2.5-flash",
]);

/**
 * Normaliza el identificador del modelo Gemini y actualiza automáticamente
 * nombres de modelos retirados (ej. `gemini-2.5-flash`) a `gemini-3.8-flash`.
 */
export function resolveGeminiModel(rawModel?: string | undefined): string {
  const cleaned = (rawModel ?? "")
    .trim()
    .replace(/^models\//i, "");
  if (!cleaned || RETIRED_GEMINI_MODELS.has(cleaned.toLowerCase())) {
    return GEMINI_DEFAULT_MODEL;
  }
  return cleaned;
}

/**
 * REQ-3.1: Contrato JSON estricto devuelto por el motor de IA.
 */
export interface AIPostResponse {
  post_type: AIPostType;
  copy_text: string;
  recommended_visual_tags: string[];
  call_to_action_used: boolean;
}

/** Riesgo 2 (Alucinación JSON): Máximo de reintentos adicionales si el JSON es inválido. */
export const MAX_JSON_RETRIES = 2;

const VALID_POST_TYPES: readonly AIPostType[] = ["FEED_SINGLE", "FEED_CAROUSEL", "STORY"];

/**
 * Esquema JSON nativo para `generationConfig.responseSchema` en Gemini API,
 * garantizando que el modelo responda en el primer intento con la estructura exacta de REQ-3.1.
 */
export const AI_POST_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    post_type: {
      type: "STRING",
      enum: ["FEED_SINGLE", "FEED_CAROUSEL", "STORY"],
    },
    copy_text: {
      type: "STRING",
    },
    recommended_visual_tags: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
    call_to_action_used: {
      type: "BOOLEAN",
    },
  },
  required: [
    "post_type",
    "copy_text",
    "recommended_visual_tags",
    "call_to_action_used",
  ],
} as const;

export const VISION_TAGS_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    tags: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
  },
  required: ["tags"],
} as const;

interface GeminiCandidatePart {
  text?: unknown;
  thought?: boolean | undefined;
  inlineData?: { mimeType?: unknown; data?: unknown } | undefined;
}

/**
 * Extrae el texto JSON final devuelto por Gemini ignorando partes internas de razonamiento (`thought: true`).
 */
export function extractGeminiResponseText(payload: {
  candidates?: Array<{
    content?: { parts?: GeminiCandidatePart[] };
  }>;
}): string | null {
  const parts = payload.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;

  const nonThoughtParts = parts.filter(
    (part) => !part.thought && typeof part.text === "string" && part.text.trim().length > 0,
  );
  const selected =
    nonThoughtParts[nonThoughtParts.length - 1] ??
    parts.find((part) => typeof part.text === "string" && part.text.trim().length > 0);

  return typeof selected?.text === "string" ? selected.text : null;
}

function buildGeminiThinkingConfig(model: string): { thinkingLevel: "LOW" } | undefined {
  const resolved = resolveGeminiModel(model).toLowerCase();
  if (resolved.startsWith("gemini-3")) {
    return { thinkingLevel: "LOW" };
  }
  return undefined;
}

/**
 * Error de transporte HTTP o cuota del proveedor (ej. 400/403 API Key inválida, 429 límite de cuota, 500).
 * No debe reintentarse como si fuera una alucinación de formato JSON.
 */
export class AIProviderHttpError extends Error {
  readonly status: number;
  readonly code?: string | undefined;

  constructor(message: string, status: number, code?: string | undefined) {
    super(message);
    this.name = "AIProviderHttpError";
    this.status = status;
    this.code = code;
  }
}

export function buildGeminiEndpoint(model: string, apiKey: string): string {
  const safeModel = encodeURIComponent(resolveGeminiModel(model));
  const safeKey = encodeURIComponent(apiKey);
  return `${GEMINI_API_BASE_URL}/${safeModel}:generateContent?key=${safeKey}`;
}

async function buildGeminiHttpError(
  response: Response,
  contextLabel: string,
): Promise<AIProviderHttpError> {
  let code: string | undefined;
  let apiMessage: string | undefined;
  try {
    const errJson = (await response.json()) as {
      error?: { status?: string; code?: number; message?: string };
    };
    code = errJson?.error?.status;
    apiMessage = errJson?.error?.message;
  } catch {
    // Ignorar si el cuerpo de error no es JSON
  }

  if (response.status === 429) {
    return new AIProviderHttpError(
      `${contextLabel} respondió con estado 429 (límite de peticiones por minuto alcanzado en Gemini API)`,
      429,
      code ?? "RESOURCE_EXHAUSTED",
    );
  }

  if (response.status === 400 || response.status === 401 || response.status === 403) {
    const detail = apiMessage ? `: ${apiMessage}` : "";
    return new AIProviderHttpError(
      `${contextLabel} respondió con estado ${response.status} (verifica tu VITE_GEMINI_API_KEY)${detail}`,
      response.status,
      code,
    );
  }

  const detail = apiMessage ? `: ${apiMessage}` : "";
  return new AIProviderHttpError(
    `${contextLabel} respondió con estado ${response.status}${detail}`,
    response.status,
    code,
  );
}

function normalizeTag(tag: string): string {
  return tag.replace(/^#+/, "").trim().toLowerCase();
}

function normalizeHashtagToken(rawTag: string): string {
  const clean = rawTag
    .replace(/^#+/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-záéíóúñü0-9_]/gi, "");
  return clean ? `#${clean}` : "";
}

function stripMarkdownCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

/**
 * Extrae `mimeType` y `data` (base64 puro) a partir de un Data URL (`data:image/jpeg;base64,...`).
 */
export function extractInlineDataFromDataUrl(
  dataUrl: string,
): { mimeType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl.trim());
  if (!match || !match[1] || !match[2]) return null;
  return {
    mimeType: match[1].trim(),
    data: match[2].trim(),
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

/**
 * Resuelve un Data URL o una URL pública de imagen a `{ mimeType, data }` en base64
 * para enviarlo en `inlineData` a Gemini Vision.
 */
export async function resolveImageToInlineData(
  imageUrl: string,
  fetchFn?: typeof fetch | undefined,
): Promise<{ mimeType: string; data: string }> {
  const fromDataUrl = extractInlineDataFromDataUrl(imageUrl);
  if (fromDataUrl) {
    return fromDataUrl;
  }

  const fetchImpl = fetchFn ?? fetch;
  const response = await fetchImpl(imageUrl);
  if (!response.ok) {
    throw new Error(`No se pudo descargar la imagen para análisis visual (${response.status})`);
  }

  const contentType = response.headers?.get?.("content-type") || "image/jpeg";
  const mimeType = contentType.split(";")[0]?.trim() || "image/jpeg";
  const buffer = await response.arrayBuffer();
  return {
    mimeType,
    data: arrayBufferToBase64(buffer),
  };
}

/**
 * REQ-2.2: Construye el prompt agnóstico al giro de negocio para que el modelo de visión
 * analice un activo y devuelva etiquetas descriptivas en formato JSON estricto.
 */
export function buildVisionTaggingPrompt(branchName?: string): string {
  const brandContext = branchName ? ` para la marca o sucursal "${branchName}"` : "";
  return [
    `Analiza visualmente esta imagen${brandContext}.`,
    "Identifica los elementos visuales principales (producto, servicio, personas, equipo, instalaciones, ambiente, promoción, infografía o contexto visual).",
    'Devuelve ÚNICAMENTE un objeto JSON válido con la propiedad "tags" que contenga entre 3 y 5 etiquetas descriptivas en español en minúsculas con prefijo #.',
    'Incluye al menos una categoría funcional (#producto, #servicio, #ambiente, #comunidad, #educativo u #oferta) junto con etiquetas específicas de lo que aparece en la imagen (ej. {"tags": ["#producto", "#ambiente", "#detalle_visual"]}).',
  ].join(" ");
}

/**
 * REQ-2.2: Valida y normaliza la respuesta JSON del modelo de visión computacional
 * garantizando una lista no vacía de hashtags en minúsculas.
 */
export function parseAndValidateVisionTagsResponse(raw: unknown): string[] {
  let parsed: unknown = raw;

  if (typeof raw === "string") {
    const cleaned = stripMarkdownCodeFence(raw);
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error("Respuesta de visión IA no es un JSON válido.");
    }
  }

  let rawList: unknown;
  if (Array.isArray(parsed)) {
    rawList = parsed;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    rawList = obj["tags"] ?? obj["visual_tags"] ?? obj["recommended_visual_tags"];
  }

  if (!Array.isArray(rawList) || rawList.length === 0) {
    throw new Error("Respuesta de visión IA debe incluir un arreglo no vacío de etiquetas.");
  }

  const normalized = Array.from(
    new Set(
      rawList
        .filter((item): item is string => typeof item === "string")
        .map(normalizeHashtagToken)
        .filter((tag) => tag.length > 1),
    ),
  ).slice(0, 6);

  if (normalized.length === 0) {
    throw new Error("Respuesta de visión IA no produjo etiquetas válidas.");
  }

  return normalized;
}

/**
 * Convierte un archivo o Blob de imagen en un Data URL (base64) para enviarlo
 * directamente a Gemini Vision (`gemini-2.5-flash`).
 */
export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === "undefined") {
      reject(new Error("FileReader no está disponible en este entorno."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("No se pudo codificar la imagen en base64."));
      }
    };
    reader.onerror = () => reject(new Error("Error leyendo el archivo de imagen."));
    reader.readAsDataURL(file);
  });
}

/**
 * REQ-2.2: Invoca Google Gemini (`gemini-2.5-flash`) con capacidades de Visión para etiquetar una imagen.
 */
export async function callGeminiVisionForTags(params: {
  imageUrl: string;
  apiKey: string;
  branchName?: string | undefined;
  model?: string | undefined;
  fetchFn?: typeof fetch | undefined;
}): Promise<string[]> {
  const fetchImpl = params.fetchFn ?? fetch;
  const model = params.model || GEMINI_DEFAULT_MODEL;
  const inlineData = await resolveImageToInlineData(params.imageUrl, fetchImpl);
  const endpoint = buildGeminiEndpoint(model, params.apiKey);
  const thinkingConfig = buildGeminiThinkingConfig(model);

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text: "Eres un asistente experto en visión computacional y catalogación de activos digitales para marketing de marcas. Responde siempre con un objeto JSON válido.",
          },
        ],
      },
      contents: [
        {
          role: "user",
          parts: [
            { text: buildVisionTaggingPrompt(params.branchName) },
            {
              inlineData: {
                mimeType: inlineData.mimeType,
                data: inlineData.data,
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: VISION_TAGS_RESPONSE_SCHEMA,
        temperature: 0.2,
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
    }),
  });

  if (!response.ok) {
    throw await buildGeminiHttpError(response, "Gemini Vision");
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: GeminiCandidatePart[] };
    }>;
  };
  const content = extractGeminiResponseText(payload);
  if (!content) {
    throw new Error("Gemini Vision devolvió una respuesta vacía.");
  }

  return parseAndValidateVisionTagsResponse(content);
}

/**
 * REQ-2.2: Orquestador de auto-etiquetado visual para activos.
 * Prioriza Google Gemini Vision (`gemini-2.5-flash`), luego Webhook IA.
 * Cuando `allowFilenameFallback` es `true` (por defecto al subir un archivo nuevo),
 * usa `inferTagsFromFilename` si la IA no está disponible para no abortar la subida a Supabase Storage;
 * cuando es `false` (ej. botón "Sugerir con IA Vision"), exige que el proveedor IA responda.
 */
export async function analyzeAssetImageTags(options: {
  imageUrl?: string | undefined;
  filename: string;
  branchName?: string | undefined;
  apiKey?: string | undefined;
  webhookUrl?: string | undefined;
  model?: string | undefined;
  allowFilenameFallback?: boolean | undefined;
  fetchFn?: typeof fetch | undefined;
}): Promise<{ tags: string[]; source: VisionTagSource }> {
  const apiKey = (
    options.apiKey ??
    (import.meta.env["VITE_GEMINI_API_KEY"] as string | undefined) ??
    ""
  ).trim();
  const webhookUrl = (
    options.webhookUrl ??
    (import.meta.env["VITE_AI_WEBHOOK_URL"] as string | undefined) ??
    ""
  ).trim();
  const model = resolveGeminiModel(
    options.model ?? (import.meta.env["VITE_GEMINI_MODEL"] as string | undefined),
  );
  const allowFallback = options.allowFilenameFallback ?? true;
  const fetchImpl = options.fetchFn ?? fetch;
  const imageUrl = options.imageUrl?.trim();

  if (!apiKey && !webhookUrl) {
    if (!allowFallback) {
      throw new Error(
        "No hay proveedor de visión configurado. Define VITE_GEMINI_API_KEY en las variables de entorno.",
      );
    }
    return {
      tags: inferTagsFromFilename(options.filename),
      source: "filename_fallback",
    };
  }

  if (apiKey && imageUrl) {
    try {
      const tags = await callGeminiVisionForTags({
        imageUrl,
        apiKey,
        branchName: options.branchName,
        model,
        fetchFn: fetchImpl,
      });
      return { tags, source: "gemini" };
    } catch (err) {
      if (!allowFallback && !webhookUrl) {
        throw err;
      }
      console.warn("Fallo en auto-tagging con Gemini Vision:", err);
    }
  }

  if (webhookUrl && imageUrl) {
    try {
      const response = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "vision_tags",
          image_url: imageUrl,
          filename: options.filename,
          branch_name: options.branchName,
        }),
      });
      if (!response.ok) {
        throw new Error(`Webhook Vision respondió con estado ${response.status}`);
      }
      const raw = await response.json();
      const tags = parseAndValidateVisionTagsResponse(raw);
      return { tags, source: "webhook" };
    } catch (err) {
      if (!allowFallback) {
        throw err;
      }
      console.warn("Fallo en auto-tagging por Webhook:", err);
    }
  }

  return {
    tags: inferTagsFromFilename(options.filename),
    source: "filename_fallback",
  };
}

/**
 * REQ-3.1 y Riesgo 2: Valida que la respuesta del modelo cumpla estrictamente el esquema JSON.
 */
export function parseAndValidateAIPostResponse(raw: unknown): AIPostResponse {
  let parsed: unknown = raw;

  if (typeof raw === "string") {
    const cleaned = stripMarkdownCodeFence(raw);
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error("Respuesta de IA no es un JSON válido.");
    }
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Respuesta de IA debe ser un objeto JSON.");
  }

  const obj = parsed as Record<string, unknown>;
  const postType = obj["post_type"];
  const copyText = obj["copy_text"];
  const visualTags = obj["recommended_visual_tags"];
  const ctaUsed = obj["call_to_action_used"];

  if (
    typeof postType !== "string" ||
    !VALID_POST_TYPES.includes(postType as AIPostType)
  ) {
    throw new Error("Campo post_type inválido o ausente.");
  }

  if (typeof copyText !== "string" || copyText.trim().length === 0) {
    throw new Error("Campo copy_text debe ser un texto no vacío.");
  }

  if (
    !Array.isArray(visualTags) ||
    visualTags.length === 0 ||
    !visualTags.every((t) => typeof t === "string" && t.trim().length > 0)
  ) {
    throw new Error("Campo recommended_visual_tags debe ser una lista no vacía de strings.");
  }

  if (typeof ctaUsed !== "boolean") {
    throw new Error("Campo call_to_action_used debe ser booleano.");
  }

  return {
    post_type: postType as AIPostType,
    copy_text: copyText.trim(),
    recommended_visual_tags: visualTags.map((t) => t.trim()),
    call_to_action_used: ctaUsed,
  };
}

/**
 * Riesgo 2 (Alucinación JSON): Ejecuta el generador y reintenta hasta `maxRetries` veces
 * adicionales (por defecto 2) si la validación del JSON falla.
 * Si el proveedor lanza un error HTTP de cuota/autenticación (`AIProviderHttpError`),
 * propaga el error de inmediato sin reintentar inútilmente.
 */
export async function generateWithRetry(
  providerCall: (attempt: number) => Promise<unknown>,
  maxRetries = MAX_JSON_RETRIES,
): Promise<AIPostResponse> {
  let lastError: Error = new Error("Fallo en generación de IA");
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const raw = await providerCall(attempt);
      return parseAndValidateAIPostResponse(raw);
    } catch (err) {
      if (err instanceof AIProviderHttpError) {
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw new Error(
    `Generación abortada tras ${maxRetries + 1} intentos por JSON inválido: ${lastError.message}`,
  );
}

/**
 * REQ-3.2 (Algoritmo de Cruce) y REQ-2.3 (Control de Desgaste):
 * Selecciona el activo con mayor coincidencia de etiquetas y menor contador de uso.
 * Si no hay activos disponibles (Riesgo 1: Inventario Cero), devuelve null.
 */
export function selectBestMatchingAsset(
  assets: Asset[],
  recommendedTags: string[],
): Asset | null {
  if (assets.length === 0) return null;

  const targetTags = recommendedTags.map(normalizeTag).filter(Boolean);

  const scored = assets.map((asset, index) => {
    const assetTags = asset.tags.map(normalizeTag).filter(Boolean);
    const matchCount = targetTags.reduce((acc, target) => {
      const matched = assetTags.some(
        (at) => at === target || at.includes(target) || target.includes(at),
      );
      return matched ? acc + 1 : acc;
    }, 0);

    return {
      asset,
      matchCount,
      uses: asset.uses,
      index,
    };
  });

  scored.sort((a, b) => {
    if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
    if (a.uses !== b.uses) return a.uses - b.uses;
    return a.index - b.index;
  });

  return scored[0]?.asset ?? null;
}

/**
 * REQ-1.3: En Modo Supervisado el post nace en `pendiente`; solo en Modo Autónomo pasa a `programado`.
 */
export function resolveInitialPostStatus(
  isAutonomousMode: boolean,
): "pendiente" | "programado" {
  return isAutonomousMode ? "programado" : "pendiente";
}

/**
 * REQ-3.1: Construye el prompt de usuario agnóstico al tipo de industria con las etiquetas
 * disponibles en el banco y la especificación estricta del contrato JSON.
 */
export function buildPostGenerationUserPrompt(params: {
  branchName: string;
  availableTags: string[];
  variantIndex?: number | undefined;
}): string {
  const normalizedTags = Array.from(
    new Set(params.availableTags.map(normalizeTag).filter(Boolean)),
  );
  const tagsList =
    normalizedTags.length > 0
      ? normalizedTags.join(", ")
      : "producto, servicio, ambiente, comunidad";

  return [
    `Redacta una nueva publicación para redes sociales de la marca/sucursal "${params.branchName}" (variante #${(params.variantIndex ?? 0) + 1}).`,
    `Etiquetas visuales disponibles actualmente en la biblioteca de activos: [${tagsList}].`,
    "Adapta el mensaje a la identidad de la marca, su tono de comunicación y el contexto que sugieren sus etiquetas visuales disponibles, sin asumir un giro de negocio ajeno a sus datos.",
    "Devuelve ÚNICAMENTE un objeto JSON válido con esta estructura exacta:",
    '{ "post_type": "FEED_SINGLE" | "FEED_CAROUSEL" | "STORY", "copy_text": "<texto persuasivo en español con emojis y hashtags acordes a la marca>", "recommended_visual_tags": ["<etiqueta_1>", "<etiqueta_2>"], "call_to_action_used": true }',
    "Elige en `recommended_visual_tags` de 1 a 3 etiquetas que coincidan con las disponibles en la biblioteca y respeta estrictamente las reglas negativas del sistema.",
  ].join(" ");
}

/**
 * REQ-3.1: Invoca Google Gemini (`gemini-2.5-flash`) para generar el JSON de la publicación.
 */
export async function callGeminiForPost(params: {
  systemPrompt: string;
  userPrompt: string;
  apiKey: string;
  model?: string | undefined;
  fetchFn?: typeof fetch | undefined;
}): Promise<unknown> {
  const fetchImpl = params.fetchFn ?? fetch;
  const model = params.model || GEMINI_DEFAULT_MODEL;
  const endpoint = buildGeminiEndpoint(model, params.apiKey);
  const thinkingConfig = buildGeminiThinkingConfig(model);

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: params.systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: params.userPrompt }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: AI_POST_RESPONSE_SCHEMA,
        temperature: 0.7,
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
    }),
  });

  if (!response.ok) {
    throw await buildGeminiHttpError(response, "Gemini API");
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: GeminiCandidatePart[] };
    }>;
  };
  const content = extractGeminiResponseText(payload);
  if (!content) {
    throw new Error("Gemini API devolvió una respuesta vacía.");
  }

  return content;
}

export interface GeneratePostOptions {
  apiKey?: string | undefined;
  webhookUrl?: string | undefined;
  model?: string | undefined;
  pillars?: Pillar[] | undefined;
  fetchFn?: typeof fetch | undefined;
}

/**
 * Orquestador del Motor IA (REQ-1.2 + REQ-3.1 + REQ-3.2 + Riesgo 2):
 * Exige un proveedor IA real (`VITE_GEMINI_API_KEY` o `VITE_AI_WEBHOOK_URL`),
 * valida el contrato JSON con hasta 2 reintentos y cruza el activo óptimo.
 */
export async function generateSocialPostForBranch(
  branch: Pick<Sucursal, "id" | "nombre" | "tono" | "reglas_negativas">,
  assets: Asset[],
  variantIndex = 0,
  options?: GeneratePostOptions,
): Promise<{
  aiResponse: AIPostResponse;
  matchedAsset: Asset;
  systemPrompt: string;
  provider: AIProviderSource;
}> {
  if (assets.length === 0) {
    throw new Error("Banco de Contenido Agotado: No hay activos disponibles en esta sucursal.");
  }

  const apiKey = (
    options?.apiKey ??
    (import.meta.env["VITE_GEMINI_API_KEY"] as string | undefined) ??
    ""
  ).trim();
  const webhookUrl = (
    options?.webhookUrl ??
    (import.meta.env["VITE_AI_WEBHOOK_URL"] as string | undefined) ??
    ""
  ).trim();
  const model = resolveGeminiModel(
    options?.model ?? (import.meta.env["VITE_GEMINI_MODEL"] as string | undefined),
  );
  const fetchImpl = options?.fetchFn ?? fetch;

  if (!apiKey && !webhookUrl) {
    throw new Error(
      "No hay un proveedor de IA configurado. Define VITE_GEMINI_API_KEY en las variables de entorno.",
    );
  }

  const systemPrompt = buildBrandSystemPrompt(branch, options?.pillars);
  const availableTags = Array.from(new Set(assets.flatMap((a) => a.tags)));
  const userPrompt = buildPostGenerationUserPrompt({
    branchName: branch.nombre,
    availableTags,
    variantIndex,
  });

  const provider: AIProviderSource = apiKey ? "gemini" : "webhook";

  const aiResponse = await generateWithRetry(async () => {
    if (apiKey) {
      return callGeminiForPost({
        systemPrompt,
        userPrompt,
        apiKey,
        model,
        fetchFn: fetchImpl,
      });
    }

    const response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sucursal_id: branch.id,
        system_prompt: systemPrompt,
        user_prompt: userPrompt,
        available_tags: availableTags,
      }),
    });
    if (!response.ok) {
      throw new AIProviderHttpError(
        `Webhook respondió con estado ${response.status}`,
        response.status,
      );
    }
    return response.json();
  });

  const matchedAsset = selectBestMatchingAsset(assets, aiResponse.recommended_visual_tags);
  if (!matchedAsset) {
    throw new Error("Banco de Contenido Agotado: No se encontró un activo válido.");
  }

  return { aiResponse, matchedAsset, systemPrompt, provider };
}

/* ------------------------------------------------------------------------- *
 * Generador Semanal de Imágenes con IA (Google Gemini / Imagen API)
 *
 * Regla de negocio: el lote semanal se reparte siempre con la mezcla de
 * pilares 40% Venta / 30% Educativo / 30% Estilo de vida, salvo que la marca
 * configure otra distribución. Todo el texto que se envía al modelo se
 * construye desde la sucursal activa, nunca con supuestos de giro de negocio.
 * ------------------------------------------------------------------------- */

export type WeeklyContentPillar = "VENTA" | "EDUCATIVO" | "ESTILO_DE_VIDA";
export type WeeklyImageAspectRatio = "1:1" | "4:5" | "9:16";

export const WEEKLY_CONTENT_PILLARS: readonly WeeklyContentPillar[] = [
  "VENTA",
  "EDUCATIVO",
  "ESTILO_DE_VIDA",
];

/** Regla de pilares del pack semanal: 40% Venta, 30% Educativo, 30% Estilo de vida. */
export const WEEKLY_PILLAR_SHARES: Record<WeeklyContentPillar, number> = {
  VENTA: 40,
  EDUCATIVO: 30,
  ESTILO_DE_VIDA: 30,
};

export const WEEKLY_PILLAR_LABELS: Record<WeeklyContentPillar, string> = {
  VENTA: "Venta / Producto",
  EDUCATIVO: "Educativo",
  ESTILO_DE_VIDA: "Estilo de vida / Comunidad",
};

export const WEEKLY_PILLAR_HASHTAGS: Record<WeeklyContentPillar, string> = {
  VENTA: "#venta",
  EDUCATIVO: "#educativo",
  ESTILO_DE_VIDA: "#estilo_de_vida",
};

/** Proporciones de imagen compatibles con Meta Graph API (REQ-2.1). */
export const WEEKLY_IMAGE_ASPECT_RATIOS: readonly WeeklyImageAspectRatio[] = [
  "1:1",
  "4:5",
  "9:16",
];

export const WEEKLY_IMAGE_ASPECT_RATIO_LABELS: Record<WeeklyImageAspectRatio, string> = {
  "1:1": "Feed cuadrado (1:1)",
  "4:5": "Feed vertical (4:5)",
  "9:16": "Stories / Reels (9:16)",
};

export const DEFAULT_WEEKLY_IMAGE_ASPECT_RATIO: WeeklyImageAspectRatio = "4:5";
export const MIN_WEEKLY_IMAGE_COUNT = 1;
export const MAX_WEEKLY_IMAGE_COUNT = 5;
export const DEFAULT_WEEKLY_IMAGE_COUNT = 3;

export const GEMINI_DEFAULT_IMAGE_MODEL = "gemini-nano-banana-2.1";

/** Etiqueta aplicada a todo activo creado por el generador semanal. */
export const AI_GENERATED_TAG = "#ia_generada";

const RETIRED_GEMINI_IMAGE_MODELS = new Set([
  "imagen-3.0-generate-001",
  // Identificador de marcador usado antes de conectar la API real de imágenes.
  "gemini-3.8-flash-image",
]);

/** Resoluciones de salida admitidas por los modelos Nano Banana (uppercase K obligatorio). */
export const SUPPORTED_GEMINI_IMAGE_SIZES = ["512", "1K", "2K", "4K"] as const;
export type GeminiImageSize = (typeof SUPPORTED_GEMINI_IMAGE_SIZES)[number];

/**
 * Normaliza la resolución de salida opcional (`512`, `1K`, `2K`, `4K`).
 * Si no se configura, no se envía `imageSize` y el modelo usa su valor por defecto.
 */
export function resolveGeminiImageSize(
  raw?: string | undefined,
): GeminiImageSize | undefined {
  const cleaned = (raw ?? "").trim().toUpperCase().replace(/PX$/, "");
  if (cleaned === "0.5K") return "512";
  const found = SUPPORTED_GEMINI_IMAGE_SIZES.find((size) => size === cleaned);
  return found;
}

/**
 * Normaliza el modelo de generación de imágenes. Si la variable no está definida
 * usa `GEMINI_DEFAULT_IMAGE_MODEL`; los modelos `imagen-*` se invocan con `:predict`.
 */
export function resolveGeminiImageModel(rawModel?: string | undefined): string {
  const cleaned = (rawModel ?? "").trim().replace(/^models\//i, "");
  if (!cleaned || RETIRED_GEMINI_IMAGE_MODELS.has(cleaned.toLowerCase())) {
    return GEMINI_DEFAULT_IMAGE_MODEL;
  }
  return cleaned;
}

/** Los modelos Imagen usan el endpoint `:predict`; los Gemini usan `:generateContent`. */
export function isImagenPredictModel(model: string): boolean {
  return /^imagen/i.test(resolveGeminiImageModel(model));
}

export function buildGeminiImageEndpoint(model: string, apiKey: string): string {
  const safeModel = encodeURIComponent(resolveGeminiImageModel(model));
  const safeKey = encodeURIComponent(apiKey);
  const method = isImagenPredictModel(model) ? "predict" : "generateContent";
  return `${GEMINI_API_BASE_URL}/${safeModel}:${method}?key=${safeKey}`;
}

/**
 * Acota la cantidad de imágenes del lote al rango soportado (1 a 5).
 * Un valor inválido cae en `DEFAULT_WEEKLY_IMAGE_COUNT`.
 */
export function normalizeWeeklyImageCount(rawCount?: number | undefined): number {
  if (typeof rawCount !== "number" || !Number.isFinite(rawCount)) {
    return DEFAULT_WEEKLY_IMAGE_COUNT;
  }
  return Math.min(MAX_WEEKLY_IMAGE_COUNT, Math.max(MIN_WEEKLY_IMAGE_COUNT, Math.round(rawCount)));
}

/** Garantiza una relación de aspecto aceptada por la API (1:1, 4:5 o 9:16). */
export function resolveWeeklyImageAspectRatio(
  raw?: string | undefined,
): WeeklyImageAspectRatio {
  const cleaned = (raw ?? "").trim();
  const found = WEEKLY_IMAGE_ASPECT_RATIOS.find((ratio) => ratio === cleaned);
  return found ?? DEFAULT_WEEKLY_IMAGE_ASPECT_RATIO;
}

export interface WeeklyBatchPlanItem {
  index: number;
  pillar: WeeklyContentPillar;
  label: string;
  hashtag: string;
  sharePercent: number;
  aspectRatio: WeeklyImageAspectRatio;
}

/**
 * Planifica el lote semanal repartiendo `count` imágenes entre los pilares según
 * sus porcentajes (por defecto 40/30/30). Usa el método del mayor residuo para
 * no perder ni duplicar piezas y alterna los pilares para no agrupar el mismo
 * tema en días consecutivos.
 */
export function calculateWeeklyBatchPlan(params: {
  count: number;
  shares?: Partial<Record<WeeklyContentPillar, number>> | undefined;
  aspectRatio?: string | undefined;
}): WeeklyBatchPlanItem[] {
  const total = normalizeWeeklyImageCount(params.count);
  const aspectRatio = resolveWeeklyImageAspectRatio(params.aspectRatio);

  const weights = WEEKLY_CONTENT_PILLARS.map((pillar) => {
    const raw = params.shares?.[pillar];
    const value =
      typeof raw === "number" && Number.isFinite(raw)
        ? Math.max(0, raw)
        : WEEKLY_PILLAR_SHARES[pillar];
    return { pillar, value };
  });

  let weightTotal = weights.reduce((acc, w) => acc + w.value, 0);
  if (weightTotal <= 0) {
    for (const weight of weights) weight.value = 1;
    weightTotal = weights.length;
  }

  const exactCounts = weights.map((w) => (w.value / weightTotal) * total);
  const counts = exactCounts.map((value) => Math.floor(value));
  let pending = total - counts.reduce((a, b) => a + b, 0);

  const byRemainder = exactCounts
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (const { index } of byRemainder) {
    if (pending <= 0) break;
    counts[index] = (counts[index] ?? 0) + 1;
    pending -= 1;
  }

  const remainingByPillar = new Map<WeeklyContentPillar, number>();
  WEEKLY_CONTENT_PILLARS.forEach((pillar, index) => {
    remainingByPillar.set(pillar, counts[index] ?? 0);
  });

  const plan: WeeklyBatchPlanItem[] = [];
  for (let index = 0; index < total; index++) {
    let chosen: WeeklyContentPillar | null = null;
    let bestRemaining = 0;
    for (const pillar of WEEKLY_CONTENT_PILLARS) {
      const left = remainingByPillar.get(pillar) ?? 0;
      if (left > bestRemaining) {
        bestRemaining = left;
        chosen = pillar;
      }
    }
    if (!chosen) break;

    remainingByPillar.set(chosen, bestRemaining - 1);
    const weight = weights.find((w) => w.pillar === chosen)?.value ?? 0;

    plan.push({
      index,
      pillar: chosen,
      label: WEEKLY_PILLAR_LABELS[chosen],
      hashtag: WEEKLY_PILLAR_HASHTAGS[chosen],
      sharePercent: Math.round((weight / weightTotal) * 1000) / 10,
      aspectRatio,
    });
  }

  return plan;
}

const TONE_VISUAL_GUIDES: ReadonlyArray<{ pattern: RegExp; guide: string }> = [
  {
    pattern: /cercan|amable|c[áa]lid|humano|emp[áa]tic/i,
    guide:
      "luz natural cálida, personas reales con expresiones espontáneas, planos cercanos y una atmósfera acogedora",
  },
  {
    pattern: /profesional|corporativ|formal|institucional/i,
    guide:
      "composición limpia y minimalista, iluminación de estudio suave, profundidad de campo controlada y paleta sobria",
  },
  {
    pattern: /divertid|alegre|juvenil|energ[ée]tic/i,
    guide:
      "colores vivos, movimiento y energía, ángulos dinámicos y situaciones alegres y desenfadadas",
  },
  {
    pattern: /inspirador|aspiracional|premium|elegante|lujo/i,
    guide:
      "estética editorial aspiracional, luz cinematográfica, texturas ricas y acabado premium",
  },
  {
    pattern: /modern|vanguard|tecno|minimal/i,
    guide:
      "geometrías limpias, alto contraste, sombras nítidas y estética contemporánea de editorial",
  },
];

const DEFAULT_TONE_VISUAL_GUIDE =
  "fotografía comercial luminosa, composición equilibrada, colores fieles a la marca y acabado profesional";

/** Traduce el tono de voz de la marca en una guía de estilo fotográfico. */
export function describeToneVisualStyle(tone?: string | undefined): string {
  const cleaned = (tone ?? "").trim();
  if (!cleaned) return DEFAULT_TONE_VISUAL_GUIDE;
  const match = TONE_VISUAL_GUIDES.find((entry) => entry.pattern.test(cleaned));
  return match?.guide ?? DEFAULT_TONE_VISUAL_GUIDE;
}

/** Objetivo narrativo de cada pilar de contenido, sin asumir un giro de negocio. */
export function describeWeeklyPillarObjective(pillar: WeeklyContentPillar): string {
  switch (pillar) {
    case "VENTA":
      return "objetivo comercial: el producto o servicio es el protagonista absoluto, mostrado en primer plano con detalle de textura, calidad y acabado";
    case "EDUCATIVO":
      return "objetivo educativo: ilustra un proceso, un detrás de cámaras o un detalle técnico que enseñe algo útil a la audiencia";
    case "ESTILO_DE_VIDA":
      return "objetivo de comunidad: escena de uso real donde personas disfrutan la experiencia de la marca en su día a día";
    default:
      return "objetivo de marca: escena versátil que represente la propuesta de valor del negocio";
  }
}

export interface WeeklyImagePromptParams {
  branchName: string;
  pillar: WeeklyContentPillar;
  tone?: string | undefined;
  negativeRules?: string | undefined;
  theme?: string | undefined;
  aspectRatio?: string | undefined;
  variantIndex?: number | undefined;
}

/**
 * Construye el prompt visual profesional de una pieza del lote semanal.
 * Inyecta identidad de marca, pilar, estilo según el tono, contexto de campaña
 * y las reglas negativas como exclusión estricta. Nunca menciona un giro de
 * negocio específico que la sucursal no haya declarado.
 */
export function buildWeeklyImagePrompt(params: WeeklyImagePromptParams): string {
  const branchName = params.branchName.trim() || "la marca";
  const aspectRatio = resolveWeeklyImageAspectRatio(params.aspectRatio);
  const tone = params.tone?.trim() || "Cercano";
  const theme = params.theme?.trim();
  const negativeRules = params.negativeRules?.trim();
  const variant = Math.max(0, Math.round(params.variantIndex ?? 0)) + 1;

  return [
    `Fotografía publicitaria profesional para redes sociales de "${branchName}" en formato ${aspectRatio} (relación de aspecto compatible con Meta).`,
    `Pilar de contenido: ${WEEKLY_PILLAR_LABELS[params.pillar]}. ${describeWeeklyPillarObjective(params.pillar)}.`,
    `Estilo visual obligatorio según el tono de marca "${tone}": ${describeToneVisualStyle(tone)}.`,
    theme
      ? `Contexto o campaña de la semana: ${theme}.`
      : "Contexto de la semana: escena cotidiana y versátil que represente la propuesta de valor de la marca.",
    `Variante visual #${variant}: cambia encuadre, ángulo o momento de la escena frente a las demás piezas del lote manteniendo la coherencia de marca.`,
    "Identidad de marca: respeta una paleta cromática coherente y un ambiente auténtico; no inventes logotipos ni textos legibles dentro de la imagen.",
    negativeRules
      ? `Reglas negativas de la marca (excluir por completo de la imagen): [${negativeRules}].`
      : "",
    "Calidad: alta resolución, foco nítido, iluminación profesional, sin texto deformado, sin letras ilegibles, sin marcas de agua ni firmas.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Etiquetas automáticas de un activo generado por IA: marca + pilar de contenido. */
export function buildGeneratedAssetTags(pillar: WeeklyContentPillar): string[] {
  return [AI_GENERATED_TAG, WEEKLY_PILLAR_HASHTAGS[pillar]];
}

export interface WeeklyBatchSummaryItem {
  pillar: WeeklyContentPillar;
  label: string;
  sharePercent: number;
  count: number;
}

/**
 * Resumen deduplicado del lote para la UI: cuántas piezas aporta cada pilar y
 * con qué peso dentro del total (sin repetir la misma fila por cada imagen).
 */
export function summarizeWeeklyBatchPlan(
  plan: WeeklyBatchPlanItem[],
): WeeklyBatchSummaryItem[] {
  const byPillar = new Map<WeeklyContentPillar, WeeklyBatchSummaryItem>();
  for (const item of plan) {
    const current = byPillar.get(item.pillar);
    if (current) {
      current.count += 1;
    } else {
      byPillar.set(item.pillar, {
        pillar: item.pillar,
        label: item.label,
        sharePercent: item.sharePercent,
        count: 1,
      });
    }
  }
  return Array.from(byPillar.values());
}

interface GeminiInlineImage {
  mimeType: string;
  base64: string;
}

function readInlineImagePart(part: unknown): GeminiInlineImage | null {
  if (!part || typeof part !== "object") return null;
  const inline = (part as { inlineData?: unknown }).inlineData;
  if (!inline || typeof inline !== "object") return null;
  const data = (inline as { data?: unknown }).data;
  if (typeof data !== "string" || data.trim().length === 0) return null;
  const mimeType = (inline as { mimeType?: unknown }).mimeType;
  return {
    mimeType: typeof mimeType === "string" && mimeType.trim() ? mimeType.trim() : "image/png",
    base64: data.trim(),
  };
}

/**
 * Extrae la imagen generada de cualquiera de los dos contratos de la API:
 * `predictions[].bytesBase64Encoded` (Imagen) o `parts[].inlineData` (Gemini).
 */
export function extractInlineImageFromGeminiPayload(payload: unknown): GeminiInlineImage | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;

  const predictions = obj["predictions"];
  if (Array.isArray(predictions)) {
    for (const prediction of predictions) {
      if (!prediction || typeof prediction !== "object") continue;
      const record = prediction as Record<string, unknown>;
      const data = record["bytesBase64Encoded"];
      if (typeof data === "string" && data.trim().length > 0) {
        const mimeType = record["mimeType"];
        return {
          mimeType:
            typeof mimeType === "string" && mimeType.trim() ? mimeType.trim() : "image/png",
          base64: data.trim(),
        };
      }
    }
  }

  const candidates = obj["candidates"];
  if (Array.isArray(candidates)) {
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") continue;
      const parts = (candidate as { content?: { parts?: unknown } }).content?.parts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        const image = readInlineImagePart(part);
        if (image) return image;
      }
    }
  }

  return null;
}

export interface GenerateImageParams {
  prompt: string;
  pillar: WeeklyContentPillar;
  apiKey?: string | undefined;
  aspectRatio?: string | undefined;
  /** `512`, `1K`, `2K` o `4K`. Si se omite, se toma `VITE_GEMINI_IMAGE_SIZE`. */
  imageSize?: string | undefined;
  model?: string | undefined;
  fetchFn?: typeof fetch | undefined;
}

export interface GeneratedImage {
  provider: "gemini";
  model: string;
  prompt: string;
  pillar: WeeklyContentPillar;
  aspectRatio: WeeklyImageAspectRatio;
  mimeType: string;
  base64: string;
  dataUrl: string;
  tags: string[];
}

/**
 * Genera una imagen con Google Gemini / Imagen API y la devuelve lista para
 * previsualizar (`dataUrl`) o subir a Supabase Storage (`base64` + `mimeType`).
 * Soporta `imagen-*` (`:predict`) y modelos Gemini multimodales (`:generateContent`).
 */
export async function generateImageWithGemini(
  params: GenerateImageParams,
): Promise<GeneratedImage> {
  const apiKey = (
    params.apiKey ??
    (import.meta.env["VITE_GEMINI_API_KEY"] as string | undefined) ??
    ""
  ).trim();
  if (!apiKey) {
    throw new Error(
      "No hay API Key de Gemini configurada para generar imágenes. Define VITE_GEMINI_API_KEY en las variables de entorno.",
    );
  }

  const prompt = params.prompt.trim();
  if (!prompt) {
    throw new Error("El prompt visual no puede estar vacío.");
  }

  const fetchImpl = params.fetchFn ?? fetch;
  const model = resolveGeminiImageModel(
    params.model ?? (import.meta.env["VITE_GEMINI_IMAGE_MODEL"] as string | undefined),
  );
  const aspectRatio = resolveWeeklyImageAspectRatio(params.aspectRatio);
  const imageSize = resolveGeminiImageSize(
    params.imageSize ?? (import.meta.env["VITE_GEMINI_IMAGE_SIZE"] as string | undefined),
  );
  const usesPredict = isImagenPredictModel(model);

  const body = usesPredict
    ? {
        instances: [{ prompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio,
        },
      }
    : {
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: {
            aspectRatio,
            ...(imageSize ? { imageSize } : {}),
          },
        },
      };

  const response = await fetchImpl(buildGeminiImageEndpoint(model, apiKey), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await buildGeminiHttpError(response, "Gemini Image");
  }

  const payload: unknown = await response.json();
  const inlineImage = extractInlineImageFromGeminiPayload(payload);
  if (!inlineImage) {
    throw new Error(
      "Gemini Image no devolvió ninguna imagen. Verifica que el modelo configurado en VITE_GEMINI_IMAGE_MODEL soporte generación de imágenes.",
    );
  }

  return {
    provider: "gemini",
    model,
    prompt,
    pillar: params.pillar,
    aspectRatio,
    mimeType: inlineImage.mimeType,
    base64: inlineImage.base64,
    dataUrl: `data:${inlineImage.mimeType};base64,${inlineImage.base64}`,
    tags: buildGeneratedAssetTags(params.pillar),
  };
}
