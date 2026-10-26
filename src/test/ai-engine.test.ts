import { describe, expect, it, vi } from "vitest";

import {
  GEMINI_DEFAULT_MODEL,
  MAX_JSON_RETRIES,
  analyzeAssetImageTags,
  buildGeminiEndpoint,
  buildPostGenerationUserPrompt,
  buildVisionTaggingPrompt,
  callGeminiVisionForTags,
  extractInlineDataFromDataUrl,
  generateSocialPostForBranch,
  generateWithRetry,
  parseAndValidateAIPostResponse,
  parseAndValidateVisionTagsResponse,
  resolveInitialPostStatus,
  selectBestMatchingAsset,
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
