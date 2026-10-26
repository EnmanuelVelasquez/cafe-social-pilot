import { buildBrandSystemPrompt, type Pillar } from "@/lib/brand";
import { inferTagsFromFilename, type Asset } from "@/lib/data";
import type { Sucursal } from "@/types";

export type AIPostType = "FEED_SINGLE" | "FEED_CAROUSEL" | "STORY";
export type AIProviderSource = "openai" | "webhook" | "local_fallback";
export type VisionTagSource = "openai" | "webhook" | "filename_fallback";

export const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";
export const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

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
 * REQ-2.2: Construye el prompt para que el modelo de visión analice un activo
 * y devuelva etiquetas descriptivas en formato JSON estricto.
 */
export function buildVisionTaggingPrompt(branchName?: string): string {
  const brandContext = branchName ? ` de la marca/sucursal "${branchName}"` : "";
  return [
    `Analiza visualmente esta fotografía${brandContext}.`,
    "Identifica los elementos visuales principales (producto, bebida, empaque, ambiente del local, personas, cosecha/origen, promoción, etc.).",
    'Devuelve ÚNICAMENTE un objeto JSON válido con la propiedad "tags" que contenga entre 3 y 5 etiquetas en español en minúsculas con prefijo #.',
    'Incluye al menos una categoría base (#producto, #ambiente, #origen, #comunidad, #educativo u #oferta) además de etiquetas descriptivas específicas (ej. {"tags": ["#producto", "#latte_art", "#taza", "#ambiente"]}).',
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
 * directamente a OpenAI Vision (`gpt-4o-mini`).
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
 * REQ-2.2: Invoca OpenAI `gpt-4o-mini` con capacidades de Visión para etiquetar una imagen.
 */
export async function callOpenAIVisionForTags(params: {
  imageUrl: string;
  apiKey: string;
  branchName?: string | undefined;
  model?: string | undefined;
  fetchFn?: typeof fetch | undefined;
}): Promise<string[]> {
  const fetchImpl = params.fetchFn ?? fetch;
  const model = params.model || OPENAI_DEFAULT_MODEL;

  const response = await fetchImpl(OPENAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content:
            "Eres un asistente experto en visión computacional para marketing gastronómico y de cafeterías. Responde siempre con un objeto JSON válido.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: buildVisionTaggingPrompt(params.branchName) },
            {
              type: "image_url",
              image_url: {
                url: params.imageUrl,
                detail: "low",
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI Vision respondió con estado ${response.status}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI Vision devolvió una respuesta vacía.");
  }

  return parseAndValidateVisionTagsResponse(content);
}

/**
 * REQ-2.2: Orquestador de auto-etiquetado visual para activos subidos.
 * Prioriza OpenAI Vision (`gpt-4o-mini`), luego Webhook IA y finalmente fallback por nombre de archivo.
 */
export async function analyzeAssetImageTags(options: {
  imageUrl?: string | undefined;
  filename: string;
  branchName?: string | undefined;
  apiKey?: string | undefined;
  webhookUrl?: string | undefined;
  model?: string | undefined;
  fetchFn?: typeof fetch | undefined;
}): Promise<{ tags: string[]; source: VisionTagSource }> {
  const apiKey = (
    options.apiKey ??
    (import.meta.env["VITE_OPENAI_API_KEY"] as string | undefined) ??
    ""
  ).trim();
  const webhookUrl = (
    options.webhookUrl ??
    (import.meta.env["VITE_AI_WEBHOOK_URL"] as string | undefined) ??
    ""
  ).trim();
  const model = (
    options.model ??
    (import.meta.env["VITE_OPENAI_MODEL"] as string | undefined) ??
    OPENAI_DEFAULT_MODEL
  ).trim();
  const fetchImpl = options.fetchFn ?? fetch;
  const imageUrl = options.imageUrl?.trim();

  if (apiKey && imageUrl) {
    try {
      const tags = await callOpenAIVisionForTags({
        imageUrl,
        apiKey,
        branchName: options.branchName,
        model,
        fetchFn: fetchImpl,
      });
      return { tags, source: "openai" };
    } catch (err) {
      console.warn("Fallo en auto-tagging con OpenAI Vision, aplicando fallback:", err);
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
      console.warn("Fallo en auto-tagging por Webhook, aplicando fallback:", err);
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
 * Generador contextual determinista para la sucursal activa, respetando tono y tags disponibles.
 */
export function buildContextualDraft(
  branch: Pick<Sucursal, "nombre" | "tono" | "reglas_negativas">,
  assets: Asset[],
  variantIndex = 0,
): AIPostResponse {
  const bestUnusedFirst = [...assets].sort((a, b) => a.uses - b.uses);
  const candidateAsset = bestUnusedFirst[variantIndex % Math.max(bestUnusedFirst.length, 1)];
  const candidateTags =
    candidateAsset && candidateAsset.tags.length > 0
      ? candidateAsset.tags.map(normalizeTag).filter(Boolean)
      : ["producto", "ambiente", "cafe"];

  const primaryTag = candidateTags[0] || "cafe";
  const tone = (branch.tono || "Cercano").toLowerCase();

  let copyText: string;
  if (tone.includes("profesional")) {
    copyText = `En ${branch.nombre} cuidamos cada detalle de nuestra selección de origen para ofrecerte una experiencia consistente en cada taza. Visítanos hoy y descubre nuestra propuesta. ☕✨ #${branch.nombre.replace(/\s+/g, "")} #CafeDeEspecialidad #${primaryTag}`;
  } else if (tone.includes("divertido")) {
    copyText = `Tu día pide a gritos una pausa en ${branch.nombre} ☕😄 Ven por tu taza favorita y recarga energía de la buena. ¡Te esperamos hoy! 👇 #${branch.nombre.replace(/\s+/g, "")} #PlanDeCafe #${primaryTag}`;
  } else if (tone.includes("inspirador")) {
    copyText = `Cada gran historia comienza alrededor de una buena taza en ${branch.nombre}. Regálate un momento para conectar con lo que te inspira. 🌱☕ #${branch.nombre.replace(/\s+/g, "")} #MomentosDeOrigen #${primaryTag}`;
  } else {
    copyText = `¡El aroma recién preparado ya se siente en ${branch.nombre}! ☕💛 Pasa hoy por tu mesa favorita y disfruta una taza preparada con dedicación. #${branch.nombre.replace(/\s+/g, "")} #CafeColombiano #${primaryTag}`;
  }

  return {
    post_type: "FEED_SINGLE",
    copy_text: copyText,
    recommended_visual_tags: candidateTags.slice(0, 3),
    call_to_action_used: true,
  };
}

/**
 * REQ-3.1: Construye el prompt de usuario con las etiquetas disponibles en el banco
 * y la especificación estricta del contrato JSON.
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
      : "producto, ambiente, origen, cafe";

  return [
    `Redacta una nueva publicación para redes sociales de la sucursal "${params.branchName}" (variante #${(params.variantIndex ?? 0) + 1}).`,
    `Etiquetas visuales disponibles en la biblioteca de activos: [${tagsList}].`,
    "Devuelve ÚNICAMENTE un objeto JSON válido con esta estructura exacta:",
    '{ "post_type": "FEED_SINGLE" | "FEED_CAROUSEL" | "STORY", "copy_text": "<texto persuasivo en español con emojis y hashtags>", "recommended_visual_tags": ["<etiqueta_1>", "<etiqueta_2>"], "call_to_action_used": true }',
    "Elige en `recommended_visual_tags` de 1 a 3 etiquetas que existan o coincidan con las disponibles en la biblioteca y respeta estrictamente las reglas negativas del sistema.",
  ].join(" ");
}

/**
 * REQ-3.1: Invoca OpenAI `gpt-4o-mini` para generar el JSON de la publicación.
 */
export async function callOpenAIForPost(params: {
  systemPrompt: string;
  userPrompt: string;
  apiKey: string;
  model?: string | undefined;
  fetchFn?: typeof fetch | undefined;
}): Promise<unknown> {
  const fetchImpl = params.fetchFn ?? fetch;
  const model = params.model || OPENAI_DEFAULT_MODEL;

  const response = await fetchImpl(OPENAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      temperature: 0.7,
      messages: [
        { role: "system", content: params.systemPrompt },
        { role: "user", content: params.userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API respondió con estado ${response.status}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI API devolvió una respuesta vacía.");
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
 * Orquestador híbrido del Motor IA (REQ-1.2 + REQ-3.1 + REQ-3.2 + Riesgo 2):
 * 1. Si existe `VITE_OPENAI_API_KEY`, invoca OpenAI (`gpt-4o-mini`) validando el contrato JSON con hasta 2 reintentos.
 * 2. Si existe `VITE_AI_WEBHOOK_URL`, invoca el webhook externo con el prompt de sistema.
 * 3. De lo contrario utiliza el generador contextual determinista validado con `generateWithRetry`.
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

  const systemPrompt = buildBrandSystemPrompt(branch, options?.pillars);
  const availableTags = Array.from(new Set(assets.flatMap((a) => a.tags)));
  const userPrompt = buildPostGenerationUserPrompt({
    branchName: branch.nombre,
    availableTags,
    variantIndex,
  });

  const apiKey = (
    options?.apiKey ??
    (import.meta.env["VITE_OPENAI_API_KEY"] as string | undefined) ??
    ""
  ).trim();
  const webhookUrl = (
    options?.webhookUrl ??
    (import.meta.env["VITE_AI_WEBHOOK_URL"] as string | undefined) ??
    ""
  ).trim();
  const model = (
    options?.model ??
    (import.meta.env["VITE_OPENAI_MODEL"] as string | undefined) ??
    OPENAI_DEFAULT_MODEL
  ).trim();
  const fetchImpl = options?.fetchFn ?? fetch;

  let provider: AIProviderSource = "local_fallback";

  const aiResponse = await generateWithRetry(async () => {
    if (apiKey) {
      provider = "openai";
      return callOpenAIForPost({
        systemPrompt,
        userPrompt,
        apiKey,
        model,
        fetchFn: fetchImpl,
      });
    }

    if (webhookUrl) {
      provider = "webhook";
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
        throw new Error(`Webhook respondió con estado ${response.status}`);
      }
      return response.json();
    }

    provider = "local_fallback";
    return buildContextualDraft(branch, assets, variantIndex);
  });

  const matchedAsset = selectBestMatchingAsset(assets, aiResponse.recommended_visual_tags);
  if (!matchedAsset) {
    throw new Error("Banco de Contenido Agotado: No se encontró un activo válido.");
  }

  return { aiResponse, matchedAsset, systemPrompt, provider };
}
