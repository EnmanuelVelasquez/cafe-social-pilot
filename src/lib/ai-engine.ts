import { buildBrandSystemPrompt } from "@/lib/brand";
import type { Asset } from "@/lib/data";
import type { Sucursal } from "@/types";

export type AIPostType = "FEED_SINGLE" | "FEED_CAROUSEL" | "STORY";

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

/**
 * REQ-3.1 y Riesgo 2: Valida que la respuesta del modelo cumpla estrictamente el esquema JSON.
 */
export function parseAndValidateAIPostResponse(raw: unknown): AIPostResponse {
  let parsed: unknown = raw;

  if (typeof raw === "string") {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
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
  const postType = obj.post_type;
  const copyText = obj.copy_text;
  const visualTags = obj.recommended_visual_tags;
  const ctaUsed = obj.call_to_action_used;

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
 * Orquestador híbrido del Motor IA (REQ-3.1 + REQ-3.2 + Riesgo 2):
 * Si existe `VITE_AI_WEBHOOK_URL`, invoca el webhook con el prompt de sistema (incluyendo REQ-1.2);
 * de lo contrario utiliza el generador contextual determinista validado con `generateWithRetry`.
 */
export async function generateSocialPostForBranch(
  branch: Pick<Sucursal, "id" | "nombre" | "tono" | "reglas_negativas">,
  assets: Asset[],
  variantIndex = 0,
): Promise<{ aiResponse: AIPostResponse; matchedAsset: Asset; systemPrompt: string }> {
  if (assets.length === 0) {
    throw new Error("Banco de Contenido Agotado: No hay activos disponibles en esta sucursal.");
  }

  const systemPrompt = buildBrandSystemPrompt(branch);
  const webhookUrl = import.meta.env.VITE_AI_WEBHOOK_URL as string | undefined;

  const aiResponse = await generateWithRetry(async () => {
    if (webhookUrl) {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sucursal_id: branch.id,
          system_prompt: systemPrompt,
          available_tags: Array.from(new Set(assets.flatMap((a) => a.tags))),
        }),
      });
      if (!response.ok) {
        throw new Error(`Webhook respondió con estado ${response.status}`);
      }
      return response.json();
    }

    return buildContextualDraft(branch, assets, variantIndex);
  });

  const matchedAsset = selectBestMatchingAsset(assets, aiResponse.recommended_visual_tags);
  if (!matchedAsset) {
    throw new Error("Banco de Contenido Agotado: No se encontró un activo válido.");
  }

  return { aiResponse, matchedAsset, systemPrompt };
}
