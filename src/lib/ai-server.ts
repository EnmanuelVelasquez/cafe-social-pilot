import { createClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import {
  analyzeAssetImageTags,
  generateSocialPostForBranch,
  generateWeeklyImagePromptsWithAI,
  resolveGeminiModel,
  type AIPostResponse,
  type AIProviderSource,
  type GeneratedWeeklyPrompts,
  type VisionTagSource,
  type WeeklyPromptsBranchInput,
} from "@/lib/ai-engine";
import type { Pillar } from "@/lib/brand";
import type { Asset } from "@/lib/data";
import { readServerEnv } from "@/lib/security";
import type { Sucursal } from "@/types";

export interface ServerAiDeps {
  envOverride?: Record<string, unknown> | undefined;
  fetchFn?: typeof fetch | undefined;
  verifyUserFn?: ((token: string) => Promise<boolean>) | undefined;
}

function resolveServerGeminiCredentials(envOverride?: Record<string, unknown>): {
  apiKey: string;
  webhookUrl: string;
  model: string;
} {
  const apiKey =
    readServerEnv("GEMINI_API_KEY", envOverride) ??
    readServerEnv("VITE_GEMINI_API_KEY", envOverride) ??
    "";
  const webhookUrl =
    readServerEnv("AI_WEBHOOK_URL", envOverride) ??
    readServerEnv("VITE_AI_WEBHOOK_URL", envOverride) ??
    "";
  const model = resolveGeminiModel(
    readServerEnv("GEMINI_MODEL", envOverride) ??
      readServerEnv("VITE_GEMINI_MODEL", envOverride),
  );
  return { apiKey, webhookUrl, model };
}

async function assertAuthorizedCaller(
  accessToken: string | undefined,
  deps?: ServerAiDeps,
): Promise<void> {
  const token = accessToken?.trim() ?? "";
  if (deps?.verifyUserFn) {
    if (!token || !(await deps.verifyUserFn(token))) {
      throw new Error("No autorizado: debes iniciar sesión para usar la IA.");
    }
    return;
  }

  const supabaseUrl =
    readServerEnv("SUPABASE_URL", deps?.envOverride) ??
    readServerEnv("VITE_SUPABASE_URL", deps?.envOverride) ??
    (typeof import.meta !== "undefined"
      ? (import.meta.env?.["VITE_SUPABASE_URL"] as string | undefined)
      : undefined);

  const supabaseKey =
    readServerEnv("SUPABASE_SERVICE_ROLE_KEY", deps?.envOverride) ??
    readServerEnv("VITE_SUPABASE_PUBLISHABLE_KEY", deps?.envOverride) ??
    readServerEnv("VITE_SUPABASE_ANON_KEY", deps?.envOverride) ??
    (typeof import.meta !== "undefined"
      ? ((import.meta.env?.["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
          import.meta.env?.["VITE_SUPABASE_ANON_KEY"]) as string | undefined)
      : undefined);

  if (!supabaseUrl || !supabaseKey) {
    // Modo demo sin Supabase configurado
    return;
  }

  if (!token) {
    throw new Error("No autorizado: debes iniciar sesión para usar la IA.");
  }

  const client = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    throw new Error("Sesión inválida o expirada. Vuelve a iniciar sesión.");
  }
}

export interface ServerGeneratePostInput {
  branch: Sucursal;
  assets: Asset[];
  variantIndex: number;
  pillars?: Pillar[] | undefined;
  accessToken?: string | undefined;
}

export type ServerGeneratePostResult =
  | {
      ok: true;
      aiResponse: AIPostResponse;
      matchedAsset: Asset;
      systemPrompt: string;
      provider: AIProviderSource;
    }
  | { ok: false; errorMessage: string };

/**
 * Ejecuta en el servidor la generación de copy con `GEMINI_API_KEY` (sin exponerla al navegador).
 */
export async function executeGeneratePostOnServer(
  input: ServerGeneratePostInput,
  deps?: ServerAiDeps,
): Promise<ServerGeneratePostResult> {
  try {
    await assertAuthorizedCaller(input.accessToken, deps);
    const { apiKey, webhookUrl, model } = resolveServerGeminiCredentials(
      deps?.envOverride,
    );
    if (!apiKey && !webhookUrl) {
      return {
        ok: false,
        errorMessage:
          "Falta configurar GEMINI_API_KEY (sin prefijo VITE_) en las variables de entorno del servidor (Vercel).",
      };
    }

    const result = await generateSocialPostForBranch(
      input.branch,
      input.assets,
      input.variantIndex,
      {
        apiKey,
        webhookUrl,
        model,
        pillars: input.pillars,
        fetchFn: deps?.fetchFn,
      },
    );
    return { ok: true, ...result };
  } catch (error: unknown) {
    return {
      ok: false,
      errorMessage:
        error instanceof Error
          ? error.message
          : "No se pudo generar la publicación en el servidor.",
    };
  }
}

export interface ServerAnalyzeTagsInput {
  imageUrl: string;
  filename: string;
  branchName?: string | undefined;
  allowFilenameFallback?: boolean | undefined;
  accessToken?: string | undefined;
}

export type ServerAnalyzeTagsResult =
  | { ok: true; tags: string[]; source: VisionTagSource }
  | { ok: false; errorMessage: string };

/**
 * Ejecuta en el servidor el auto-etiquetado Vision con `GEMINI_API_KEY`.
 */
export async function executeAnalyzeTagsOnServer(
  input: ServerAnalyzeTagsInput,
  deps?: ServerAiDeps,
): Promise<ServerAnalyzeTagsResult> {
  try {
    await assertAuthorizedCaller(input.accessToken, deps);
    const { apiKey, webhookUrl, model } = resolveServerGeminiCredentials(
      deps?.envOverride,
    );
    if (!apiKey && !webhookUrl && input.allowFilenameFallback === false) {
      return {
        ok: false,
        errorMessage:
          "Falta configurar GEMINI_API_KEY (sin prefijo VITE_) en las variables de entorno del servidor (Vercel).",
      };
    }

    const result = await analyzeAssetImageTags({
      imageUrl: input.imageUrl,
      filename: input.filename,
      branchName: input.branchName,
      allowFilenameFallback: input.allowFilenameFallback,
      apiKey,
      webhookUrl,
      model,
      fetchFn: deps?.fetchFn,
    });
    return { ok: true, ...result };
  } catch (error: unknown) {
    return {
      ok: false,
      errorMessage:
        error instanceof Error
          ? error.message
          : "No se pudo analizar la imagen con IA en el servidor.",
    };
  }
}

export interface ServerWeeklyPromptsInput {
  branch: WeeklyPromptsBranchInput;
  count: number;
  aspectRatio?: string | undefined;
  campaignContext?: string | undefined;
  referenceImageUrls?: string[] | undefined;
  accessToken?: string | undefined;
}

export type ServerWeeklyPromptsResult =
  | ({ ok: true } & GeneratedWeeklyPrompts)
  | { ok: false; errorMessage: string };

/**
 * Ejecuta en el servidor la generación del lote semanal de prompts visuales con `GEMINI_API_KEY`.
 */
export async function executeWeeklyPromptsOnServer(
  input: ServerWeeklyPromptsInput,
  deps?: ServerAiDeps,
): Promise<ServerWeeklyPromptsResult> {
  try {
    await assertAuthorizedCaller(input.accessToken, deps);
    const { apiKey, model } = resolveServerGeminiCredentials(deps?.envOverride);
    if (!apiKey) {
      return {
        ok: false,
        errorMessage:
          "Falta configurar GEMINI_API_KEY (sin prefijo VITE_) en las variables de entorno del servidor (Vercel).",
      };
    }

    const result = await generateWeeklyImagePromptsWithAI({
      branch: input.branch,
      count: input.count,
      aspectRatio: input.aspectRatio,
      campaignContext: input.campaignContext,
      referenceImageUrls: input.referenceImageUrls,
      apiKey,
      model,
      fetchFn: deps?.fetchFn,
    });
    return { ok: true, ...result };
  } catch (error: unknown) {
    return {
      ok: false,
      errorMessage:
        error instanceof Error
          ? error.message
          : "No se pudieron generar los prompts visuales en el servidor.",
    };
  }
}

export const generatePostServerFn = createServerFn({ method: "POST" })
  .validator((data: ServerGeneratePostInput) => {
    if (!data || !data.branch || !Array.isArray(data.assets)) {
      throw new Error("Datos inválidos para generar publicación.");
    }
    return data;
  })
  .handler(async ({ data }): Promise<ServerGeneratePostResult> => {
    return await executeGeneratePostOnServer(data);
  });

export const analyzeAssetTagsServerFn = createServerFn({ method: "POST" })
  .validator((data: ServerAnalyzeTagsInput) => {
    if (!data || typeof data.imageUrl !== "string" || !data.imageUrl.trim()) {
      throw new Error("Se requiere una URL de imagen válida.");
    }
    return data;
  })
  .handler(async ({ data }): Promise<ServerAnalyzeTagsResult> => {
    return await executeAnalyzeTagsOnServer(data);
  });

export const generateWeeklyPromptsServerFn = createServerFn({ method: "POST" })
  .validator((data: ServerWeeklyPromptsInput) => {
    if (!data || !data.branch || typeof data.count !== "number") {
      throw new Error("Datos inválidos para generar prompts visuales.");
    }
    return data;
  })
  .handler(async ({ data }): Promise<ServerWeeklyPromptsResult> => {
    return await executeWeeklyPromptsOnServer(data);
  });
