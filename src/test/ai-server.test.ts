import { describe, expect, it, vi } from "vitest";
import {
  executeAnalyzeTagsOnServer,
  executeGeneratePostOnServer,
  executeWeeklyPromptsOnServer,
} from "@/lib/ai-server";
import type { Asset } from "@/lib/data";
import type { Sucursal } from "@/types";

const sampleBranch: Sucursal = {
  id: "suc-1",
  perfil_id: "perf-1",
  nombre: "Café Don Juan - Centro",
  tono: "Cercano y cálido",
  reglas_negativas: "Nunca mencionar barato",
};

const sampleAssets: Asset[] = [
  {
    id: "act-1",
    img: "https://cdn.example.com/latte.jpg",
    name: "Taza latte",
    tags: ["#cafe", "#taza"],
    uses: 0,
  },
];

describe("Proxy seguro de Gemini en servidor (src/lib/ai-server.ts)", () => {
  it("rechaza peticiones cuando el usuario no tiene sesión válida", async () => {
    const res = await executeGeneratePostOnServer(
      {
        branch: sampleBranch,
        assets: sampleAssets,
        variantIndex: 0,
        accessToken: "",
      },
      {
        envOverride: { GEMINI_API_KEY: "secret-key" },
        verifyUserFn: async () => false,
      },
    );

    expect(res).toEqual({
      ok: false,
      errorMessage: "No autorizado: debes iniciar sesión para usar la IA.",
    });
  });

  it("indica claramente cuando falta GEMINI_API_KEY en el servidor", async () => {
    const res = await executeWeeklyPromptsOnServer(
      {
        branch: sampleBranch,
        count: 1,
        accessToken: "jwt-ok",
      },
      {
        envOverride: { GEMINI_API_KEY: "", VITE_GEMINI_API_KEY: "" },
        verifyUserFn: async () => true,
      },
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errorMessage).toContain("GEMINI_API_KEY");
    }
  });

  it("ejecuta generación de copy usando GEMINI_API_KEY solo del servidor", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      post_type: "FEED_SINGLE",
                      copy_text: "Disfruta una taza recién preparada en nuestro café artesanal.",
                      recommended_visual_tags: ["#cafe"],
                      call_to_action_used: true,
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const res = await executeGeneratePostOnServer(
      {
        branch: sampleBranch,
        assets: sampleAssets,
        variantIndex: 0,
        accessToken: "jwt-ok",
      },
      {
        envOverride: { GEMINI_API_KEY: "gemini-server-only-key" },
        verifyUserFn: async (token) => token === "jwt-ok",
        fetchFn: mockFetch as unknown as typeof fetch,
      },
    );

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.provider).toBe("gemini");
      expect(res.aiResponse.copy_text).toContain("Disfruta una taza");
      expect(res.matchedAsset.id).toBe("act-1");
    }
    const [calledUrl] = mockFetch.mock.calls[0] as [string];
    expect(calledUrl).toContain("key=gemini-server-only-key");
  });

  it("ejecuta análisis Vision en servidor usando GEMINI_API_KEY sin exponerla al cliente", async () => {
    const imageBytes = new Uint8Array([137, 80, 78, 71]);
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(imageBytes, { status: 200, headers: { "content-type": "image/jpeg" } }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify({ tags: ["#espresso", "#taza"] }) }],
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const res = await executeAnalyzeTagsOnServer(
      {
        imageUrl: "https://cdn.example.com/foto.jpg",
        filename: "foto.jpg",
        branchName: "Café Don Juan",
        allowFilenameFallback: false,
        accessToken: "jwt-ok",
      },
      {
        envOverride: { GEMINI_API_KEY: "gemini-server-only-key" },
        verifyUserFn: async () => true,
        fetchFn: mockFetch as unknown as typeof fetch,
      },
    );

    expect(res).toEqual({
      ok: true,
      tags: ["#espresso", "#taza"],
      source: "gemini",
    });
  });
});
