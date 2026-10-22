import { describe, expect, it, vi } from "vitest";

import {
  MAX_JSON_RETRIES,
  buildContextualDraft,
  generateWithRetry,
  parseAndValidateAIPostResponse,
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
