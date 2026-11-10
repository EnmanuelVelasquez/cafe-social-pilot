import { describe, expect, it, vi } from "vitest";

import {
  WEEKLY_IMAGE_PROMPTS_RESPONSE_SCHEMA,
  buildGeminiEndpoint,
  buildWeeklyVisualPromptsRequest,
  generateWeeklyImagePromptsWithAI,
  parseAndValidateWeeklyPromptsResponse,
} from "@/lib/ai-engine";
import {
  BRAND_LOGO_TAG,
  BRAND_REFERENCE_TAG,
  extractBrandReferenceAssets,
  hasBrandKitData,
  hasBrandTag,
  normalizeBrandKit,
  toggleBrandTag,
} from "@/lib/brand";
import { isMissingBrandKitColumnError } from "@/lib/data";

const VALID_PROMPTS_PAYLOAD = {
  prompts: [
    {
      pilar: "Venta / Producto",
      idea_espanol: "Muestra el producto estrella en primer plano con luz cálida.",
      prompt_ingles:
        "Professional advertising photograph, aspect ratio 4:5, warm cinematic lighting, primary color #112233. Avoid: no deformed text, no gibberish letters, no watermarks.",
      suggested_tags: ["producto", "primer plano", "luz cálida"],
    },
    {
      pilar: "Educativo",
      idea_espanol: "Explica un proceso interno en tres pasos visuales.",
      prompt_ingles:
        "Editorial documentary photograph showing a behind-the-scenes process, aspect ratio 4:5. Avoid: no deformed text, no gibberish letters, no watermarks.",
      suggested_tags: ["#proceso", "detrás de cámaras", "detalle"],
    },
    {
      pilar: "Estilo de vida / Comunidad",
      idea_espanol: "Personas disfrutando la experiencia de la marca.",
      prompt_ingles:
        "Lifestyle photograph of people enjoying the brand experience, natural light, aspect ratio 4:5. Avoid: no deformed text, no gibberish letters, no watermarks.",
      suggested_tags: ["comunidad", "experiencia", "ambiente"],
    },
  ],
};

function buildGeminiTextResponse(payload: unknown): unknown {
  return {
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify(payload) }],
        },
      },
    ],
  };
}

describe("normalizeBrandKit", () => {
  it("degrada a objeto vacío con entradas nulas, primitivas o arreglos", () => {
    expect(normalizeBrandKit(null)).toEqual({});
    expect(normalizeBrandKit(undefined)).toEqual({});
    expect(normalizeBrandKit(42)).toEqual({});
    expect(normalizeBrandKit(["#112233"])).toEqual({});
    expect(normalizeBrandKit("{ json roto")).toEqual({});
  });

  it("normaliza colores hex, estilo y bandera de logo", () => {
    const result = normalizeBrandKit({
      primary_color: "112233",
      secondary_color: "#aabbcc",
      accent_color: "  #FFF  ",
      visual_style: "  Minimalista editorial  ",
      reserve_logo_space: true,
    });

    expect(result).toEqual({
      primary_color: "#112233",
      secondary_color: "#AABBCC",
      accent_color: "#FFF",
      visual_style: "Minimalista editorial",
      reserve_logo_space: true,
    });
  });

  it("descarta colores inválidos y tipos incorrectos", () => {
    const result = normalizeBrandKit({
      primary_color: "azul",
      secondary_color: 123,
      accent_color: "#12345",
      visual_style: 99,
      reserve_logo_space: "sí",
    });

    expect(result.primary_color).toBeUndefined();
    expect(result.secondary_color).toBeUndefined();
    expect(result.accent_color).toBeUndefined();
    expect(result.visual_style).toBeUndefined();
    expect(result.reserve_logo_space).toBeUndefined();
  });

  it("acepta el JSON serializado tal como puede venir de Supabase", () => {
    const result = normalizeBrandKit(
      JSON.stringify({ primary_color: "#0F172A", reserve_logo_space: false }),
    );

    expect(result.primary_color).toBe("#0F172A");
    expect(result.reserve_logo_space).toBe(false);
  });

  it("detecta si el Brand Kit tiene datos útiles", () => {
    expect(hasBrandKitData(null)).toBe(false);
    expect(hasBrandKitData({})).toBe(false);
    expect(hasBrandKitData({ primary_color: "#112233" })).toBe(true);
    expect(hasBrandKitData({ visual_style: "Editorial" })).toBe(true);
  });
});

describe("etiquetas de marca", () => {
  it("detecta el tag con o sin # y sin distinguir mayúsculas", () => {
    expect(hasBrandTag("#brand_logo, #producto", BRAND_LOGO_TAG)).toBe(true);
    expect(hasBrandTag("BRAND_LOGO", BRAND_LOGO_TAG)).toBe(true);
    expect(hasBrandTag(["#producto", "#brand_reference"], BRAND_REFERENCE_TAG)).toBe(true);
    expect(hasBrandTag("#producto", BRAND_LOGO_TAG)).toBe(false);
  });

  it("prioriza logos y respeta el máximo de referencias", () => {
    const assets = [
      { id: "a", tags: "#brand_reference, #ambiente" },
      { id: "b", tags: "#producto" },
      { id: "c", tags: "#brand_logo" },
      { id: "d", tags: "#brand_reference" },
    ];

    const selected = extractBrandReferenceAssets(assets, 2);
    expect(selected.map((asset) => asset.id)).toEqual(["c", "a"]);

    expect(extractBrandReferenceAssets(assets, 0)).toEqual([]);
    expect(extractBrandReferenceAssets(assets, 10).map((asset) => asset.id)).toEqual([
      "c",
      "a",
      "d",
    ]);
  });

  it("alterna el tag sin duplicar ni perder las demás etiquetas", () => {
    expect(toggleBrandTag("#producto, #ambiente", BRAND_LOGO_TAG)).toBe(
      "#producto, #ambiente, #brand_logo",
    );
    expect(toggleBrandTag("#producto, #brand_logo", BRAND_LOGO_TAG)).toBe("#producto");
    expect(toggleBrandTag("", BRAND_REFERENCE_TAG)).toBe("#brand_reference");
    expect(toggleBrandTag("#brand_logo, #brand_logo", BRAND_LOGO_TAG, true)).toBe("#brand_logo");
    expect(toggleBrandTag("#producto", BRAND_LOGO_TAG, false)).toBe("#producto");
    expect(toggleBrandTag("#producto", BRAND_LOGO_TAG, true)).toBe("#producto, #brand_logo");
  });
});

describe("isMissingBrandKitColumnError", () => {
  it("reconoce los errores típicos de columna ausente", () => {
    expect(isMissingBrandKitColumnError({ code: "PGRST204" })).toBe(true);
    expect(isMissingBrandKitColumnError({ code: "42703" })).toBe(true);
    expect(
      isMissingBrandKitColumnError({
        message: 'column "brand_kit" of relation "sucursales" does not exist',
      }),
    ).toBe(true);
    expect(
      isMissingBrandKitColumnError({
        message: "Could not find the 'brand_kit' column of 'sucursales' in the schema cache",
      }),
    ).toBe(true);
  });

  it("ignora errores de otro tipo", () => {
    expect(isMissingBrandKitColumnError(null)).toBe(false);
    expect(isMissingBrandKitColumnError({ code: "23503", message: "foreign key" })).toBe(false);
    expect(
      isMissingBrandKitColumnError({ message: 'column "nombre" does not exist' }),
    ).toBe(false);
  });
});

describe("buildWeeklyVisualPromptsRequest", () => {
  const branch = {
    nombre: "Estudio Aurora",
    tono: "Cercano y profesional",
    reglas_negativas: 'Nunca mencionar a la competencia. No usar "barato".',
    brand_kit: {
      primary_color: "#112233",
      secondary_color: "#445566",
      accent_color: "#FFAA00",
      visual_style: "Minimalista editorial",
      reserve_logo_space: true,
    },
  };

  it("inyecta la paleta, el estilo y el espacio reservado para el logo", () => {
    const request = buildWeeklyVisualPromptsRequest({
      branch,
      count: 3,
      aspectRatio: "4:5",
      campaignContext: "Lanzamiento de temporada",
      referenceCount: 2,
    });

    expect(request.plan).toHaveLength(3);
    expect(request.aspectRatio).toBe("4:5");
    expect(request.systemPrompt).toContain("#112233");
    expect(request.systemPrompt).toContain("#445566");
    expect(request.systemPrompt).toContain("#FFAA00");
    expect(request.systemPrompt).toContain("Minimalista editorial");
    expect(request.systemPrompt).toContain("Nunca mencionar a la competencia");
    expect(request.userPrompt).toContain("clean uncluttered negative space in the corner");
    expect(request.userPrompt).toContain("Lanzamiento de temporada");
    expect(request.userPrompt).toContain("4:5");
    expect(request.userPrompt).toContain("Se adjuntan 2 imágenes de referencia");
    expect(request.userPrompt).toContain("no deformed text, no gibberish letters, no watermarks");
  });

  it("es agnóstico al giro de negocio y tolera un Brand Kit vacío", () => {
    const request = buildWeeklyVisualPromptsRequest({
      branch: { nombre: "Marca Genérica", tono: "Neutral", reglas_negativas: "" },
      count: 1,
    });

    expect(request.plan).toHaveLength(1);
    expect(request.brandKit).toEqual({});
    expect(request.userPrompt).not.toContain("clean uncluttered negative space");
    expect(request.systemPrompt.toLowerCase()).not.toContain("café");
    expect(request.systemPrompt.toLowerCase()).not.toContain("coffee");
    expect(request.systemPrompt).toContain("Nunca asumas el giro de negocio");
  });
});

describe("parseAndValidateWeeklyPromptsResponse", () => {
  it("valida y normaliza las piezas generadas", () => {
    const items = parseAndValidateWeeklyPromptsResponse(VALID_PROMPTS_PAYLOAD);

    expect(items).toHaveLength(3);
    expect(items[0]?.pillar).toBe("VENTA");
    expect(items[0]?.pillarLabel).toBe("Venta / Producto");
    expect(items[1]?.suggested_tags).toEqual(["proceso", "detrás de cámaras", "detalle"]);
    expect(items[0]?.idea_espanol).toContain("producto estrella");
  });

  it("acepta JSON envuelto en un bloque markdown", () => {
    const wrapped = `\`\`\`json\n${JSON.stringify(VALID_PROMPTS_PAYLOAD)}\n\`\`\``;
    expect(parseAndValidateWeeklyPromptsResponse(wrapped)).toHaveLength(3);
  });

  it("rechaza respuestas vacías, sin pilar o con JSON inválido", () => {
    expect(() => parseAndValidateWeeklyPromptsResponse({ prompts: [] })).toThrow();
    expect(() => parseAndValidateWeeklyPromptsResponse("no es json")).toThrow();
    expect(() =>
      parseAndValidateWeeklyPromptsResponse({
        prompts: [
          {
            pilar: "Pilar inventado",
            idea_espanol: "Idea",
            prompt_ingles: "Prompt",
            suggested_tags: ["a"],
          },
        ],
      }),
    ).toThrow(/pilar/i);
  });

  it("limita las etiquetas a 5 y las devuelve sin # en minúsculas", () => {
    const items = parseAndValidateWeeklyPromptsResponse({
      prompts: [
        {
          pilar: "EDUCATIVO",
          idea_espanol: "Idea",
          prompt_ingles: "Prompt",
          suggested_tags: ["#Uno", "dos", "#TRES", "cuatro", "cinco", "seis"],
        },
      ],
    });

    expect(items[0]?.suggested_tags).toEqual(["uno", "dos", "tres", "cuatro", "cinco"]);
  });
});

describe("generateWeeklyImagePromptsWithAI", () => {
  const branch = {
    nombre: "Estudio Aurora",
    tono: "Cercano",
    reglas_negativas: "Nunca mencionar a la competencia.",
    brand_kit: {
      primary_color: "#112233",
      visual_style: "Minimalista",
      reserve_logo_space: true,
    },
  };

  it("exige una API Key real", async () => {
    await expect(
      generateWeeklyImagePromptsWithAI({
        branch,
        count: 1,
        apiKey: "",
      }),
    ).rejects.toThrow(/API Key/);
  });

  it("envía el schema, el thinkingLevel y las imágenes de referencia", async () => {
    const mockFetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://cdn.example.com/")) {
        return {
          ok: true,
          blob: async () => ({
            type: "image/png",
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
          }),
        };
      }
      return {
        ok: true,
        json: async () => buildGeminiTextResponse(VALID_PROMPTS_PAYLOAD),
      };
    });

    const result = await generateWeeklyImagePromptsWithAI({
      branch,
      count: 3,
      aspectRatio: "4:5",
      campaignContext: "Lanzamiento",
      referenceImageUrls: [
        "https://cdn.example.com/logo.png",
        "https://cdn.example.com/referencia.png",
      ],
      apiKey: "AIzaSy-test-key",
      model: "gemini-3.8-flash",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.provider).toBe("gemini");
    expect(result.items).toHaveLength(3);
    expect(result.referenceImagesUsed).toBe(2);
    expect(result.plan).toHaveLength(3);

    const geminiCall = mockFetch.mock.calls.find(
      ([input]) => String(input) === buildGeminiEndpoint("gemini-3.8-flash", "AIzaSy-test-key"),
    );
    expect(geminiCall).toBeDefined();

    const body = JSON.parse(geminiCall?.[1]?.body as string);
    expect(body.systemInstruction.parts[0].text).toContain("#112233");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema).toEqual(
      WEEKLY_IMAGE_PROMPTS_RESPONSE_SCHEMA,
    );
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "LOW" });
    expect(body.contents[0].parts[0].text).toContain("Genera exactamente 3");
    expect(body.contents[0].parts).toHaveLength(3);
    expect(body.contents[0].parts[1].inlineData.mimeType).toBe("image/png");
  });

  it("ignora silenciosamente las referencias que fallan por red", async () => {
    const mockFetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://cdn.example.com/")) {
        throw new Error("CORS");
      }
      return {
        ok: true,
        json: async () => buildGeminiTextResponse(VALID_PROMPTS_PAYLOAD),
      };
    });

    const result = await generateWeeklyImagePromptsWithAI({
      branch,
      count: 3,
      referenceImageUrls: ["https://cdn.example.com/rota.png"],
      apiKey: "AIzaSy-test-key",
      model: "gemini-3.8-flash",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.referenceImagesUsed).toBe(0);
    expect(result.items).toHaveLength(3);

    const geminiCall = mockFetch.mock.calls.find(
      ([input]) => String(input).includes(":generateContent"),
    );
    const body = JSON.parse(geminiCall?.[1]?.body as string);
    expect(body.contents[0].parts).toHaveLength(1);
  });

  it("reintenta cuando el modelo devuelve un JSON inválido", async () => {
    let geminiAttempts = 0;
    const mockFetch = vi.fn(async () => {
      geminiAttempts += 1;
      if (geminiAttempts === 1) {
        return {
          ok: true,
          json: async () => ({ candidates: [{ content: { parts: [{ text: "no es json" }] } }] }),
        };
      }
      return {
        ok: true,
        json: async () => buildGeminiTextResponse(VALID_PROMPTS_PAYLOAD),
      };
    });

    const result = await generateWeeklyImagePromptsWithAI({
      branch,
      count: 3,
      apiKey: "AIzaSy-test-key",
      model: "gemini-3.8-flash",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(geminiAttempts).toBe(2);
    expect(result.items).toHaveLength(3);
  });
});
