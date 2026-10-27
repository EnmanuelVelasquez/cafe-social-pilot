import { describe, expect, it, vi } from "vitest";

import {
  AI_GENERATED_TAG,
  DEFAULT_WEEKLY_IMAGE_ASPECT_RATIO,
  GEMINI_DEFAULT_IMAGE_MODEL,
  GEMINI_DEFAULT_MODEL,
  MAX_JSON_RETRIES,
  MAX_WEEKLY_IMAGE_COUNT,
  WEEKLY_PILLAR_SHARES,
  analyzeAssetImageTags,
  buildGeminiEndpoint,
  buildGeminiImageEndpoint,
  buildGeneratedAssetTags,
  buildPostGenerationUserPrompt,
  buildVisionTaggingPrompt,
  buildWeeklyImagePrompt,
  calculateWeeklyBatchPlan,
  callGeminiVisionForTags,
  describeToneVisualStyle,
  extractGeminiResponseText,
  extractInlineDataFromDataUrl,
  extractInlineImageFromGeminiPayload,
  generateImageWithGemini,
  generateSocialPostForBranch,
  generateWithRetry,
  isImagenPredictModel,
  normalizeWeeklyImageCount,
  parseAndValidateAIPostResponse,
  parseAndValidateVisionTagsResponse,
  resolveGeminiImageModel,
  resolveGeminiImageSize,
  resolveGeminiModel,
  resolveInitialPostStatus,
  resolveWeeklyImageAspectRatio,
  selectBestMatchingAsset,
  summarizeWeeklyBatchPlan,
} from "@/lib/ai-engine";
import type { Asset } from "@/lib/data";

const mockAssets: Asset[] = [
  { id: "a-1", img: "url-1", name: "Activo 1", tags: ["#producto", "#ambiente"], uses: 5 },
  { id: "a-2", img: "url-2", name: "Activo 2", tags: ["#origen", "#educativo"], uses: 2 },
  { id: "a-3", img: "url-3", name: "Activo 3", tags: ["#producto", "#ambiente"], uses: 0 },
];

describe("Validador JSON y Reintentos del Motor IA (REQ-3.1 y Riesgo 2)", () => {
  it("valida un payload JSON estricto o envuelto en bloque markdown", () => {
    const rawJson = `\`\`\`json
    {
      "post_type": "FEED_CAROUSEL",
      "copy_text": "Simplifica tus finanzas corporativas. 👇 #Finanzas",
      "recommended_visual_tags": ["grafica", "pasos", "corporativo"],
      "call_to_action_used": true
    }
    \`\`\``;

    const result = parseAndValidateAIPostResponse(rawJson);
    expect(result.post_type).toBe("FEED_CAROUSEL");
    expect(result.recommended_visual_tags).toEqual(["grafica", "pasos", "corporativo"]);
    expect(result.call_to_action_used).toBe(true);
  });

  it("rechaza JSON corrupto o con campos faltantes", () => {
    expect(() => parseAndValidateAIPostResponse("texto suelto sin json")).toThrow();
    expect(() =>
      parseAndValidateAIPostResponse({
        post_type: "INVALIDO",
        copy_text: "Hola",
        recommended_visual_tags: ["tag"],
        call_to_action_used: true,
      }),
    ).toThrow();
  });

  it("reintenta hasta 2 veces adicionales cuando la IA devuelve JSON inválido y se recupera", async () => {
    expect(MAX_JSON_RETRIES).toBe(2);

    const provider = vi
      .fn()
      .mockResolvedValueOnce("alucinacion 1")
      .mockResolvedValueOnce("{ malformado")
      .mockResolvedValueOnce({
        post_type: "FEED_SINGLE",
        copy_text: "Post válido en el tercer intento",
        recommended_visual_tags: ["producto"],
        call_to_action_used: true,
      });

    const result = await generateWithRetry(provider);
    expect(provider).toHaveBeenCalledTimes(3);
    expect(result.copy_text).toBe("Post válido en el tercer intento");
  });

  it("aborta la generación si falla tras agotar los reintentos", async () => {
    const provider = vi.fn().mockResolvedValue("siempre corrupto");

    await expect(generateWithRetry(provider)).rejects.toThrow(/abortada tras 3 intentos/);
    expect(provider).toHaveBeenCalledTimes(3);
  });
});

describe("Algoritmo de Cruce y Control de Desgaste (REQ-3.2, REQ-2.3 y Riesgo 1)", () => {
  it("devuelve null cuando el banco está en Inventario Cero", () => {
    expect(selectBestMatchingAsset([], ["producto"])).toBeNull();
  });

  it("selecciona el activo con mayor coincidencia de tags y menor contador de uso", () => {
    // a-1 y a-3 empatan con 2 tags ("producto" y "ambiente"), pero a-3 tiene 0 usos frente a 5 de a-1
    const match = selectBestMatchingAsset(mockAssets, ["producto", "ambiente"]);
    expect(match?.id).toBe("a-3");

    // Para "origen", el único con match es a-2
    const originMatch = selectBestMatchingAsset(mockAssets, ["origen"]);
    expect(originMatch?.id).toBe("a-2");
  });

  it("asigna estado inicial según Modo Supervisado o Autónomo (REQ-1.3)", () => {
    expect(resolveInitialPostStatus(false)).toBe("pendiente");
    expect(resolveInitialPostStatus(true)).toBe("programado");
  });
});

describe("Visión Computacional y Auto-Tagging con Google Gemini (REQ-2.2)", () => {
  it("normaliza y valida las etiquetas devueltas por el modelo de visión", () => {
    const raw = `\`\`\`json
    {
      "tags": ["Producto", "#Consultoria Financiera", "ambiente", "PRODUCTO", "Equipo Corporativo"]
    }
    \`\`\``;

    const tags = parseAndValidateVisionTagsResponse(raw);
    expect(tags).toEqual([
      "#producto",
      "#consultoria_financiera",
      "#ambiente",
      "#equipo_corporativo",
    ]);
  });

  it("rechaza respuestas de visión vacías o sin etiquetas válidas", () => {
    expect(() => parseAndValidateVisionTagsResponse("{}")).toThrow();
    expect(() => parseAndValidateVisionTagsResponse({ tags: [] })).toThrow();
  });

  it("extrae mimeType y base64 de un Data URL válido", () => {
    expect(extractInlineDataFromDataUrl("data:image/webp;base64,UklGRg==")).toEqual({
      mimeType: "image/webp",
      data: "UklGRg==",
    });
    expect(extractInlineDataFromDataUrl("https://example.com/foto.jpg")).toBeNull();
  });

  it("construye el prompt de visión agnóstico al giro de negocio incluyendo el nombre de la marca", () => {
    const prompt = buildVisionTaggingPrompt("Clínica Dental Sonrisa");
    expect(prompt).toContain("Clínica Dental Sonrisa");
    expect(prompt).toContain('"tags"');
  });

  it("actualiza automáticamente modelos retirados como gemini-2.5-flash a gemini-3.8-flash", () => {
    expect(GEMINI_DEFAULT_MODEL).toBe("gemini-3.8-flash");
    expect(resolveGeminiModel("gemini-2.5-flash")).toBe("gemini-3.8-flash");
    expect(resolveGeminiModel("models/gemini-2.5-flash")).toBe("gemini-3.8-flash");
    expect(resolveGeminiModel(undefined)).toBe("gemini-3.8-flash");
  });

  it("ignora bloques internos de razonamiento (thought: true) al extraer el JSON de Gemini", () => {
    const extracted = extractGeminiResponseText({
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: "Pensando qué copy redactar..." },
              { text: '{"tags":["#servicio"]}' },
            ],
          },
        },
      ],
    });
    expect(extracted).toBe('{"tags":["#servicio"]}');
  });

  it("invoca Gemini Vision (gemini-2.5-flash) con inlineData y devuelve tags normalizados", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    tags: ["#servicio", "Consultorio Moderno", "#ambiente"],
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    const tags = await callGeminiVisionForTags({
      imageUrl: "data:image/jpeg;base64,AAA",
      apiKey: "AIzaSy-test-key",
      branchName: "Clínica Norte",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(tags).toEqual(["#servicio", "#consultorio_moderno", "#ambiente"]);
    expect(mockFetch).toHaveBeenCalledWith(
      buildGeminiEndpoint(GEMINI_DEFAULT_MODEL, "AIzaSy-test-key"),
      expect.objectContaining({
        method: "POST",
      }),
    );

    const requestBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(requestBody.contents[0].parts[1]).toEqual({
      inlineData: { mimeType: "image/jpeg", data: "AAA" },
    });
  });

  it("permite guardar usando palabras del archivo en subida inicial si la IA falla, pero exige IA cuando allowFilenameFallback es false", async () => {
    const failingFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const uploadResult = await analyzeAssetImageTags({
      imageUrl: "data:image/jpeg;base64,AAA",
      filename: "finanzas-corporativas.jpg",
      apiKey: "AIzaSy-test-key",
      allowFilenameFallback: true,
      fetchFn: failingFetch as unknown as typeof fetch,
    });

    expect(uploadResult.source).toBe("filename_fallback");
    expect(uploadResult.tags).toEqual(["#finanzas", "#corporativas"]);

    await expect(
      analyzeAssetImageTags({
        imageUrl: "data:image/jpeg;base64,AAA",
        filename: "finanzas-corporativas.jpg",
        apiKey: "",
        webhookUrl: "",
        allowFilenameFallback: false,
      }),
    ).rejects.toThrow(/VITE_GEMINI_API_KEY/);
  });
});

describe("Generación de Copy con Google Gemini sin fallback local (REQ-1.2, REQ-3.1, REQ-3.2)", () => {
  it("construye el prompt de usuario agnóstico al giro con las etiquetas disponibles en la sucursal", () => {
    const prompt = buildPostGenerationUserPrompt({
      branchName: "TechCorp Soluciones",
      availableTags: ["#servicio", "#comunidad"],
      variantIndex: 1,
    });
    expect(prompt).toContain("TechCorp Soluciones");
    expect(prompt).toContain("servicio, comunidad");
    expect(prompt).toContain("recommended_visual_tags");
  });

  it("genera el post con Gemini (gemini-2.5-flash), reintenta ante alucinación JSON y cruza el mejor activo", async () => {
    const mockFetch = vi
      .fn()
      // Primer intento: JSON corrupto
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "respuesta no json" }] } }],
        }),
      })
      // Segundo intento: JSON válido cumpliendo el contrato REQ-3.1
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      post_type: "FEED_SINGLE",
                      copy_text: "Impulsa el crecimiento de tu empresa hoy 🚀 #Innovacion",
                      recommended_visual_tags: ["origen", "educativo"],
                      call_to_action_used: true,
                    }),
                  },
                ],
              },
            },
          ],
        }),
      });

    const result = await generateSocialPostForBranch(
      {
        id: "suc-1",
        nombre: "TechCorp Norte",
        tono: "Profesional",
        reglas_negativas: "Nunca mencionar la palabra barato",
      },
      mockAssets,
      0,
      {
        apiKey: "AIzaSy-gemini-key",
        fetchFn: mockFetch as unknown as typeof fetch,
      },
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.provider).toBe("gemini");
    expect(result.aiResponse.copy_text).toContain("crecimiento");
    expect(result.matchedAsset.id).toBe("a-2");
    expect(
      result.systemPrompt.endsWith(
        "Bajo ninguna circunstancia debes mencionar o hacer alusión a lo siguiente: [Nunca mencionar la palabra barato]",
      ),
    ).toBe(true);
  });

  it("lanza error claro cuando no hay API Key ni Webhook configurado o cuando Gemini devuelve 429", async () => {
    await expect(
      generateSocialPostForBranch(
        {
          id: "suc-1",
          nombre: "Marca X",
          tono: "Corporativo",
          reglas_negativas: "No usar barato",
        },
        mockAssets,
        0,
        {
          apiKey: "",
          webhookUrl: "",
        },
      ),
    ).rejects.toThrow(/VITE_GEMINI_API_KEY/);

    const mockFetch429 = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({
        error: {
          status: "RESOURCE_EXHAUSTED",
          message: "Quota exceeded for metric",
        },
      }),
    });

    await expect(
      generateSocialPostForBranch(
        {
          id: "suc-1",
          nombre: "Marca X",
          tono: "Corporativo",
          reglas_negativas: "No usar barato",
        },
        mockAssets,
        0,
        {
          apiKey: "AIzaSy-rate-limited",
          fetchFn: mockFetch429 as unknown as typeof fetch,
        },
      ),
    ).rejects.toThrow(/429/);

    expect(mockFetch429).toHaveBeenCalledTimes(1);
  });
});

describe("Generador Semanal de Imágenes con IA (Gemini / Imagen API)", () => {
  it("reparte un lote de 5 piezas con la mezcla 40% Venta, 30% Educativo y 30% Estilo de vida", () => {
    expect(WEEKLY_PILLAR_SHARES).toEqual({
      VENTA: 40,
      EDUCATIVO: 30,
      ESTILO_DE_VIDA: 30,
    });

    const plan = calculateWeeklyBatchPlan({ count: 5, aspectRatio: "4:5" });

    expect(plan).toHaveLength(5);
    expect(plan.map((item) => item.index)).toEqual([0, 1, 2, 3, 4]);
    expect(plan.every((item) => item.aspectRatio === "4:5")).toBe(true);

    const counts = plan.reduce<Record<string, number>>((acc, item) => {
      acc[item.pillar] = (acc[item.pillar] ?? 0) + 1;
      return acc;
    }, {});

    expect(counts).toEqual({ VENTA: 2, EDUCATIVO: 2, ESTILO_DE_VIDA: 1 });
    expect(plan[0]?.sharePercent).toBe(40);

    expect(
      summarizeWeeklyBatchPlan(plan).map((item) => [item.pillar, item.count, item.sharePercent]),
    ).toEqual([
      ["VENTA", 2, 40],
      ["EDUCATIVO", 2, 30],
      ["ESTILO_DE_VIDA", 1, 30],
    ]);
  });

  it("alterna los pilares para no agrupar el mismo tema en piezas consecutivas", () => {
    const plan = calculateWeeklyBatchPlan({ count: 3 });
    expect(plan.map((item) => item.pillar)).toEqual([
      "VENTA",
      "EDUCATIVO",
      "ESTILO_DE_VIDA",
    ]);
    expect(plan.every((item) => item.sharePercent > 0)).toBe(true);
  });

  it("acota la cantidad al rango de 1 a 5 piezas y valida la proporción solicitada", () => {
    expect(MAX_WEEKLY_IMAGE_COUNT).toBe(5);
    expect(normalizeWeeklyImageCount(0)).toBe(1);
    expect(normalizeWeeklyImageCount(99)).toBe(5);
    expect(normalizeWeeklyImageCount(Number.NaN)).toBe(3);
    expect(calculateWeeklyBatchPlan({ count: 0 })).toHaveLength(1);
    expect(calculateWeeklyBatchPlan({ count: 99 })).toHaveLength(5);

    expect(resolveWeeklyImageAspectRatio("9:16")).toBe("9:16");
    expect(resolveWeeklyImageAspectRatio("16:9")).toBe(DEFAULT_WEEKLY_IMAGE_ASPECT_RATIO);
    expect(resolveWeeklyImageAspectRatio(undefined)).toBe("4:5");
  });

  it("construye un prompt visual agnóstico al giro con marca, pilar, tono, campaña y reglas negativas", () => {
    const prompt = buildWeeklyImagePrompt({
      branchName: "Clínica Dental Sonrisa",
      pillar: "EDUCATIVO",
      tone: "Profesional",
      negativeRules: "No mostrar instrumental intimidante",
      theme: "Lanzamiento de ortodoncia invisible",
      aspectRatio: "9:16",
      variantIndex: 1,
    });

    expect(prompt).toContain("Clínica Dental Sonrisa");
    expect(prompt).toContain("Educativo");
    expect(prompt).toContain("9:16");
    expect(prompt).toContain("Lanzamiento de ortodoncia invisible");
    expect(prompt).toContain("[No mostrar instrumental intimidante]");
    expect(prompt).toContain("Variante visual #2");
    expect(prompt).toContain("marcas de agua");

    // Agnóstico: nunca asume un giro de negocio que la sucursal no declaró.
    expect(prompt.toLowerCase()).not.toContain("café");
    expect(prompt.toLowerCase()).not.toContain("cafetería");
    expect(prompt.toLowerCase()).not.toContain("restaurante");
  });

  it("traduce cada tono de marca en una guía de estilo fotográfico distinta", () => {
    expect(describeToneVisualStyle("Cercano")).toContain("acogedora");
    expect(describeToneVisualStyle("Profesional")).toContain("estudio");
    expect(describeToneVisualStyle("Divertido")).toContain("energía");
    expect(describeToneVisualStyle(undefined)).toContain("comercial");
  });

  it("etiqueta los activos generados con #ia_generada y el hashtag del pilar", () => {
    expect(AI_GENERATED_TAG).toBe("#ia_generada");
    expect(buildGeneratedAssetTags("VENTA")).toEqual(["#ia_generada", "#venta"]);
    expect(buildGeneratedAssetTags("EDUCATIVO")).toEqual(["#ia_generada", "#educativo"]);
    expect(buildGeneratedAssetTags("ESTILO_DE_VIDA")).toEqual([
      "#ia_generada",
      "#estilo_de_vida",
    ]);
  });

  it("genera la imagen con un modelo Gemini multimodal y devuelve Data URL con etiquetas", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                { text: "Aquí tienes la imagen solicitada" },
                { inlineData: { mimeType: "image/png", data: "QUJD" } },
              ],
            },
          },
        ],
      }),
    });

    const result = await generateImageWithGemini({
      prompt: "Fotografía de producto premium sobre fondo neutro",
      pillar: "VENTA",
      apiKey: "AIzaSy-image-key",
      model: "gemini-nano-banana-2.1",
      aspectRatio: "1:1",
      imageSize: "2K",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      buildGeminiImageEndpoint("gemini-nano-banana-2.1", "AIzaSy-image-key"),
    );
    expect(mockFetch.mock.calls[0]?.[0]).toContain(":generateContent");

    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(body.generationConfig.imageConfig).toEqual({
      aspectRatio: "1:1",
      imageSize: "2K",
    });
    expect(body.generationConfig.responseModalities).toEqual(["TEXT", "IMAGE"]);
    expect(body.contents[0].parts[0].text).toContain("producto premium");

    expect(result.mimeType).toBe("image/png");
    expect(result.dataUrl).toBe("data:image/png;base64,QUJD");
    expect(result.tags).toEqual(["#ia_generada", "#venta"]);
    expect(result.aspectRatio).toBe("1:1");
    expect(result.provider).toBe("gemini");
  });

  it("usa el endpoint :predict y bytesBase64Encoded para modelos Imagen", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        predictions: [{ mimeType: "image/jpeg", bytesBase64Encoded: "REVG" }],
      }),
    });

    const result = await generateImageWithGemini({
      prompt: "Escena de comunidad en una terraza luminosa",
      pillar: "ESTILO_DE_VIDA",
      apiKey: "AIzaSy-imagen-key",
      model: "imagen-4.0-generate-001",
      aspectRatio: "9:16",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const calledUrl = String(mockFetch.mock.calls[0]?.[0]);
    expect(calledUrl).toContain(":predict");
    expect(calledUrl).toContain("imagen-4.0-generate-001");

    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(body.instances[0].prompt).toContain("terraza luminosa");
    expect(body.parameters).toEqual({ sampleCount: 1, aspectRatio: "9:16" });

    expect(result.mimeType).toBe("image/jpeg");
    expect(result.base64).toBe("REVG");
    expect(result.tags).toEqual(["#ia_generada", "#estilo_de_vida"]);
  });

  it("exige API Key y prompt, y falla si la respuesta no contiene ninguna imagen", async () => {
    await expect(
      generateImageWithGemini({
        prompt: "Escena cualquiera",
        pillar: "VENTA",
        apiKey: "",
      }),
    ).rejects.toThrow(/VITE_GEMINI_API_KEY/);

    await expect(
      generateImageWithGemini({
        prompt: "   ",
        pillar: "VENTA",
        apiKey: "AIzaSy-test-key",
      }),
    ).rejects.toThrow(/prompt visual/i);

    const textOnlyFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "No puedo generar esa imagen" }] } }],
      }),
    });

    await expect(
      generateImageWithGemini({
        prompt: "Escena cualquiera",
        pillar: "VENTA",
        apiKey: "AIzaSy-test-key",
        fetchFn: textOnlyFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/no devolvió ninguna imagen/i);
  });

  it("propaga el error HTTP de la API de imágenes sin reintentar", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: "API key not valid" } }),
    });

    await expect(
      generateImageWithGemini({
        prompt: "Escena cualquiera",
        pillar: "VENTA",
        apiKey: "AIzaSy-invalid",
        fetchFn: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/403/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("extrae la imagen de ambos contratos de la API y devuelve null si no hay imagen", () => {
    expect(
      extractInlineImageFromGeminiPayload({
        predictions: [{ bytesBase64Encoded: "AAA" }],
      }),
    ).toEqual({ mimeType: "image/png", base64: "AAA" });

    expect(
      extractInlineImageFromGeminiPayload({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: "image/webp", data: "BBB" } }],
            },
          },
        ],
      }),
    ).toEqual({ mimeType: "image/webp", base64: "BBB" });

    expect(extractInlineImageFromGeminiPayload({})).toBeNull();
    expect(extractInlineImageFromGeminiPayload(null)).toBeNull();
    expect(
      extractInlineImageFromGeminiPayload({
        candidates: [{ content: { parts: [{ text: "solo texto" }] } }],
      }),
    ).toBeNull();
  });

  it("resuelve modelos retirados de imagen y detecta el tipo de endpoint", () => {
    expect(GEMINI_DEFAULT_IMAGE_MODEL).toBe("gemini-nano-banana-2.1");
    expect(resolveGeminiImageModel(undefined)).toBe(GEMINI_DEFAULT_IMAGE_MODEL);
    expect(resolveGeminiImageModel("models/imagen-3.0-generate-001")).toBe(
      GEMINI_DEFAULT_IMAGE_MODEL,
    );
    // El identificador de marcador anterior se migra al modelo real de Nano Banana.
    expect(resolveGeminiImageModel("gemini-3.8-flash-image")).toBe(
      GEMINI_DEFAULT_IMAGE_MODEL,
    );
    // Los modelos vigentes se respetan tal cual (Nano Banana 2 y Nano Banana Pro).
    expect(resolveGeminiImageModel("gemini-3.1-flash-image")).toBe(
      "gemini-3.1-flash-image",
    );
    expect(resolveGeminiImageModel("gemini-3-pro-image")).toBe("gemini-3-pro-image");
    expect(isImagenPredictModel("imagen-4.0-generate-001")).toBe(true);
    expect(isImagenPredictModel("gemini-nano-banana-2.1")).toBe(false);
  });

  it("normaliza la resolución opcional y no envía imageSize si no se configura", async () => {
    expect(resolveGeminiImageSize("2k")).toBe("2K");
    expect(resolveGeminiImageSize("512px")).toBe("512");
    expect(resolveGeminiImageSize("0.5K")).toBe("512");
    expect(resolveGeminiImageSize("")).toBeUndefined();
    expect(resolveGeminiImageSize("8K")).toBeUndefined();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: "image/png", data: "QUJD" } }],
            },
          },
        ],
      }),
    });

    await generateImageWithGemini({
      prompt: "Escena de marca sin resolución forzada",
      pillar: "EDUCATIVO",
      apiKey: "AIzaSy-image-key",
      model: "gemini-nano-banana-2.1",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(body.generationConfig.imageConfig).toEqual({ aspectRatio: "4:5" });
  });
});
