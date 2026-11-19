import { describe, expect, it } from "vitest";
import {
  authorizeCronRequest,
  normalizeSocialNetworkLabel,
  resolveConfiguredCronSecret,
  timingSafeEqualStrings,
} from "@/lib/security";

describe("Seguridad de endpoint cron y utilidades", () => {
  it("rechaza peticiones cron (503 fail-closed) si CRON_SECRET no está configurado", () => {
    const headers = new Headers({ authorization: "Bearer cualquiera" });
    expect(authorizeCronRequest(headers, undefined)).toEqual({
      authorized: false,
      status: 503,
      error: "Endpoint cron deshabilitado: falta configurar CRON_SECRET en el servidor.",
    });
    expect(authorizeCronRequest(headers, "   ")).toEqual({
      authorized: false,
      status: 503,
      error: "Endpoint cron deshabilitado: falta configurar CRON_SECRET en el servidor.",
    });
  });

  it("rechaza con 401 cuando el secreto proporcionado no coincide", () => {
    const headers = new Headers({ authorization: "Bearer secreto-malo" });
    expect(authorizeCronRequest(headers, "secreto-real-123")).toEqual({
      authorized: false,
      status: 401,
      error: "No autorizado (CRON_SECRET inválido).",
    });
  });

  it("autoriza con Bearer token o encabezado x-cron-secret válido", () => {
    const bearerHeaders = new Headers({ authorization: "Bearer secreto-real-123" });
    expect(authorizeCronRequest(bearerHeaders, "secreto-real-123")).toEqual({
      authorized: true,
      status: 200,
    });

    const cronHeaders = new Headers({ "x-cron-secret": "secreto-real-123" });
    expect(authorizeCronRequest(cronHeaders, "secreto-real-123")).toEqual({
      authorized: true,
      status: 200,
    });
  });

  it("resuelve CRON_SECRET desde envRecord o retorna undefined si está vacío", () => {
    expect(resolveConfiguredCronSecret({ CRON_SECRET: "  mi-clave  " })).toBe("mi-clave");
    expect(resolveConfiguredCronSecret({ CRON_SECRET: "   " })).toBeUndefined();
  });

  it("compara cadenas en tiempo constante respetando longitud y contenido", () => {
    expect(timingSafeEqualStrings("abc123", "abc123")).toBe(true);
    expect(timingSafeEqualStrings("abc123", "abc124")).toBe(false);
    expect(timingSafeEqualStrings("abc", "abcd")).toBe(false);
  });

  it("normaliza nombres de red social de la API formal hacia el formato de la UI", () => {
    expect(normalizeSocialNetworkLabel("facebook")).toBe("Facebook");
    expect(normalizeSocialNetworkLabel("  Facebook ")).toBe("Facebook");
    expect(normalizeSocialNetworkLabel("instagram")).toBe("Instagram");
    expect(normalizeSocialNetworkLabel(null)).toBe("Instagram");
  });
});
