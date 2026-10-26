import { describe, expect, it, vi } from "vitest";

import {
  MAX_JSON_RETRIES,
  OPENAI_CHAT_COMPLETIONS_URL,
  OPENAI_DEFAULT_MODEL,
  analyzeAssetImageTags,
  buildContextualDraft,
  buildPostGenerationUserPrompt,
  buildVisionTaggingPrompt,
  callOpenAIVisionForTags,
  generateSocialPostForBranch,
  generateWithRetry,
  parseAndValidateAIPostResponse,
  parseAndValidateVisionTagsResponse,
  resolveInitialPostStatus,
  selectBestMatchingAsset,
} from "@/lib/ai-engine";
import type { Asset } from "@/lib/data";

const mockAssets: Asset[] = [
  { id: "a-1", img: "url-1", name: "Taza", tags: ["#producto", "#ambiente"], uses: 5 },
  { id: "a-2", img: "url-2", name: "Cosecha", tags: ["#origen", "#educativo"], uses: 2 },
  { id: "a-3", img: "url-3", name: "Latte Nuevo", tags: ["#producto", "#ambiente"], uses: 0 },
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

  it("construye un borrador contextual válido para la sucursal", () => {
    const draft = buildContextualDraft(
      {
        nombre: "Sede Norte",
        tono: "Profesional",
        reglas_negativas: "No usar barato",
      },
      mockAssets,
    );

    expect(parseAndValidateAIPostResponse(draft).copy_text).toContain("Sede Norte");
  });
});

describe("Visión Computacional y Auto-Tagging con OpenAI gpt-4o-mini (REQ-2.2)", () => {
  it("normaliza y valida las etiquetas devueltas por el modelo de visión", () => {
    const raw = `\`\`\`json
    {
      "tags": ["Producto", "#Latte Art", "ambiente", "PRODUCTO", "Café Especial"]
    }
    \`\`\``;

    const tags = parseAndValidateVisionTagsResponse(raw);
    expect(tags).toEqual(["#producto", "#latte_art", "#ambiente", "#café_especial"]);
  });

  it("rechaza respuestas de visión vacías o sin etiquetas válidas", () => {
    expect(() => parseAndValidateVisionTagsResponse("{}")).toThrow();
    expect(() => parseAndValidateVisionTagsResponse({ tags: [] })).toThrow();
  });

  it("construye el prompt de visión incluyendo el nombre de la sucursal", () => {
    const prompt = buildVisionTaggingPrompt("Sede Chapinero");
    expect(prompt).toContain("Sede Chapinero");
    expect(prompt).toContain('"tags"');
  });

  it("invoca OpenAI Vision (gpt-4o-mini) con payload multimodal y devuelve tags normalizados", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                tags: ["#producto", "Capuchino Cremoso", "#ambiente"],
              }),
            },
          },
        ],
      }),
    });

    const tags = await callOpenAIVisionForTags({
      imageUrl: "data:image/jpeg;base64,AAA",
      apiKey: "sk-test-key",
      branchName: "Sede Centro",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(tags).toEqual(["#producto", "#capuchino_cremoso", "#ambiente"]);
    expect(mockFetch).toHaveBeenCalledWith(
      OPENAI_CHAT_COMPLETIONS_URL,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test-key",
        }),
      }),
    );

    const requestBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(requestBody.model).toBe(OPENAI_DEFAULT_MODEL);
    expect(requestBody.messages[1].content[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,AAA", detail: "low" },
    });
  });

  it("usa fallback por nombre de archivo si OpenAI Vision falla o no hay API key", async () => {
    const failingFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const result = await analyzeAssetImageTags({
      imageUrl: "https://example.com/cosecha-huila.jpg",
      filename: "cosecha-huila.jpg",
      apiKey: "sk-test-key",
      fetchFn: failingFetch as unknown as typeof fetch,
    });

    expect(result.source).toBe("filename_fallback");
    expect(result.tags).toEqual(["#cosecha", "#huila"]);
  });
});

describe("Generación de Copy con OpenAI gpt-4o-mini y Reintentos (REQ-1.2, REQ-3.1, REQ-3.2)", () => {
  it("construye el prompt de usuario con las etiquetas disponibles en la sucursal", () => {
    const prompt = buildPostGenerationUserPrompt({
      branchName: "Sede Norte",
      availableTags: ["#producto", "#origen"],
      variantIndex: 1,
    });
    expect(prompt).toContain("Sede Norte");
    expect(prompt).toContain("producto, origen");
    expect(prompt).toContain("recommended_visual_tags");
  });

  it("genera el post con OpenAI gpt-4o-mini, reintenta ante alucinación JSON y cruza el mejor activo", async () => {
    const mockFetch = vi
      .fn()
      // Primer intento: JSON corrupto
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "respuesta no json" } }],
        }),
      })
      // Segundo intento: JSON válido cumpliendo el contrato REQ-3.1
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  post_type: "FEED_SINGLE",
                  copy_text: "Descubre el origen del Huila en cada taza ☕🌱 #CafeDeOrigen",
                  recommended_visual_tags: ["origen", "educativo"],
                  call_to_action_used: true,
                }),
              },
            },
          ],
        }),
      });

    const result = await generateSocialPostForBranch(
      {
        id: "suc-1",
        nombre: "Sede Centro",
        tono: "Inspirador",
        reglas_negativas: "Nunca mencionar la palabra barato",
      },
      mockAssets,
      0,
      {
        apiKey: "sk-openai-key",
        fetchFn: mockFetch as unknown as typeof fetch,
      },
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.provider).toBe("openai");
    expect(result.aiResponse.copy_text).toContain("Huila");
    expect(result.matchedAsset.id).toBe("a-2");
    expect(
      result.systemPrompt.endsWith(
        "Bajo ninguna circunstancia debes mencionar o hacer alusión a lo siguiente: [Nunca mencionar la palabra barato]",
      ),
    ).toBe(true);
  });
});
