import { describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  buildApiEndpointUrl,
  buildApiHeaders,
  createAssetViaApi,
  createPublicationViaApi,
  fetchPublicationsViaApi,
  resolveApiBaseUrl,
} from "@/lib/api-client";

describe("Cliente de API formal (Render)", () => {
  it("valida y normaliza VITE_API_URL exigiendo HTTPS en remoto o localhost en desarrollo", () => {
    expect(resolveApiBaseUrl("https://api-autosocial-ai.onrender.com/")).toBe(
      "https://api-autosocial-ai.onrender.com",
    );
    expect(resolveApiBaseUrl("  http://localhost:3000/  ")).toBe("http://localhost:3000");
    expect(resolveApiBaseUrl("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(resolveApiBaseUrl("http://api.ejemplo.com")).toBeNull();
    expect(resolveApiBaseUrl("")).toBeNull();
    expect(resolveApiBaseUrl("no-es-url")).toBeNull();
  });

  it("construye URLs y cabeceras HTTP con JWT opcional", () => {
    expect(
      buildApiEndpointUrl("https://api-autosocial-ai.onrender.com/", "api/activos"),
    ).toBe("https://api-autosocial-ai.onrender.com/api/activos");

    expect(buildApiHeaders()).toEqual({ Accept: "application/json" });
    expect(buildApiHeaders({ accessToken: "jwt-123", hasBody: true })).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: "Bearer jwt-123",
    });
  });

  it("crea un activo a través de POST /api/activos enviando el payload esperado", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          mensaje: "Activo creado",
          activo: {
            id: "act-1",
            sucursal_id: "suc-1",
            url_imagen: "https://cdn.example.com/foto.jpg",
            tags: "#cafe, #origen",
            contador_uso: 0,
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );

    const created = await createAssetViaApi({
      sucursalId: "suc-1",
      urlImagen: "https://cdn.example.com/foto.jpg",
      tags: "#cafe, #origen",
      accessToken: "token-abc",
      baseUrl: "https://api-autosocial-ai.onrender.com",
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(created.id).toBe("act-1");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api-autosocial-ai.onrender.com/api/activos");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: "Bearer token-abc",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      sucursal_id: "suc-1",
      url_imagen: "https://cdn.example.com/foto.jpg",
      tags: "#cafe, #origen",
    });
  });

  it("propaga el error de validación de negocio devuelto por la API formal", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Regla de negocio: debes incluir al menos una etiqueta en el campo tags.",
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      createAssetViaApi({
        sucursalId: "suc-1",
        urlImagen: "https://cdn.example.com/foto.jpg",
        tags: "",
        baseUrl: "https://api-autosocial-ai.onrender.com",
        fetchImpl: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({
      name: "ApiRequestError",
      status: 400,
      message: "Regla de negocio: debes incluir al menos una etiqueta en el campo tags.",
    });
  });

  it("consulta publicaciones y agenda publicaciones usando el cliente tipado", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ total: 1, publicaciones: [{ id: "p-1" }] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ publicacion: { id: "p-2" } }), { status: 201 }),
      );

    const list = await fetchPublicationsViaApi({
      baseUrl: "https://api-autosocial-ai.onrender.com",
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    expect(list).toEqual({ total: 1, publicaciones: [{ id: "p-1" }] });

    const pub = await createPublicationViaApi({
      sucursalId: "suc-1",
      activoId: "act-1",
      textoCopy: "Una publicación válida con más de 10 caracteres",
      fechaPublicacion: "2026-12-01T15:00:00.000Z",
      redSocial: "Instagram",
      baseUrl: "https://api-autosocial-ai.onrender.com",
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    expect(pub).toEqual({ publicacion: { id: "p-2" } });
    expect(ApiRequestError).toBeDefined();
  });
});
