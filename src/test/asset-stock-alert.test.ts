import { describe, expect, it } from "vitest";

import {
  LOW_STOCK_THRESHOLD,
  MAX_ASSET_SIZE_BYTES,
  MAX_POST_COPY_LENGTH,
  assets,
  countUnused,
  extractStoragePath,
  formatTagsString,
  hasAffectedRows,
  inferTagsFromFilename,
  isLowStock,
  isZeroInventory,
  parseDatetimeLocalToIso,
  parseTags,
  toDatetimeLocalInputValue,
  validateAssetFile,
  validatePostEditPayload,
  type Asset,
} from "@/lib/data";

const bank = (unused: number, used = 1): Asset[] =>
  Array.from({ length: unused + used }, (_, i) => ({
    id: i,
    img: "",
    name: `activo ${i}`,
    tags: [],
    uses: i < unused ? 0 : 3,
  }));

describe("Alerta de banco de activos bajo y Riesgo de Inventario Cero", () => {
  it("el umbral es de 5 imágenes sin usar", () => {
    expect(LOW_STOCK_THRESHOLD).toBe(5);
  });

  it("cuenta solo las imágenes que nunca se han usado", () => {
    // En el banco de Café Don Juan solo "Bolsa grano entero" tiene 0 usos.
    expect(countUnused(assets)).toBe(1);
  });

  it("avisa cuando quedan menos de 5 imágenes sin usar", () => {
    expect(isLowStock(bank(4))).toBe(true);
    expect(isLowStock(assets)).toBe(true);
  });

  it("no avisa con 5 imágenes sin usar o más", () => {
    expect(isLowStock(bank(5))).toBe(false);
    expect(isLowStock(bank(9))).toBe(false);
  });

  it("detecta Inventario Cero cuando no hay activos disponibles", () => {
    expect(isZeroInventory([])).toBe(true);
    expect(isZeroInventory(0)).toBe(true);
    expect(isZeroInventory(assets)).toBe(false);
    expect(isZeroInventory(3)).toBe(false);
  });
});

describe("Validación de archivos de activos (REQ-2.1) y utilidades de Storage/Tags/RLS (REQ-2.2)", () => {
  it("acepta formatos JPG, PNG y WEBP de hasta 8 MB", () => {
    expect(validateAssetFile({ size: 1024 * 500, type: "image/jpeg" })).toEqual({ valid: true });
    expect(validateAssetFile({ size: MAX_ASSET_SIZE_BYTES, type: "image/png" })).toEqual({ valid: true });
    expect(validateAssetFile({ size: 2048, type: "image/webp" })).toEqual({ valid: true });
  });

  it("rechaza archivos vacíos, formatos no soportados o mayores a 8 MB", () => {
    expect(validateAssetFile({ size: 0, type: "image/jpeg" }).valid).toBe(false);
    expect(validateAssetFile({ size: 1024, type: "application/pdf" }).valid).toBe(false);
    expect(validateAssetFile({ size: MAX_ASSET_SIZE_BYTES + 1, type: "image/jpeg" }).valid).toBe(false);
  });

  it("extrae la ruta interna del bucket galeria desde una URL pública de Supabase", () => {
    const url =
      "https://xyz.supabase.co/storage/v1/object/public/galeria/sucursal-123/1710000000-cafe_latte.jpg";
    expect(extractStoragePath(url, "galeria")).toBe("sucursal-123/1710000000-cafe_latte.jpg");
    expect(extractStoragePath("https://example.com/image.jpg", "galeria")).toBeNull();
  });

  it("infiere tags iniciales del nombre del archivo o usa fallback por defecto", () => {
    expect(inferTagsFromFilename("cosecha-huila-origen.jpg")).toEqual([
      "#cosecha",
      "#huila",
      "#origen",
    ]);
    expect(inferTagsFromFilename("IMG_20261021_001.jpg")).toEqual(["#producto", "#ambiente"]);
  });

  it("parsea y normaliza cadenas de etiquetas para Supabase", () => {
    expect(parseTags("#producto, #ambiente")).toEqual(["#producto", "#ambiente"]);
    expect(formatTagsString("Producto, ambiente, #OFERTA, producto")).toBe(
      "#producto, #ambiente, #oferta",
    );
  });

  it("detecta cuando una operación DELETE o UPDATE en Supabase afectó 0 filas por bloqueo RLS", () => {
    expect(hasAffectedRows([])).toBe(false);
    expect(hasAffectedRows(null)).toBe(false);
    expect(hasAffectedRows([{ id: "abc" }])).toBe(true);
  });
});

describe("Edición y Reprogramación de Publicaciones en el Dashboard (Fase B)", () => {
  it("convierte fechas entre ISO y formato datetime-local de forma consistente", () => {
    const sampleDate = new Date(2026, 9, 28, 15, 30, 0);
    const localInput = toDatetimeLocalInputValue(sampleDate);
    expect(localInput).toBe("2026-10-28T15:30");

    const parsedIso = parseDatetimeLocalToIso(localInput);
    expect(parsedIso).toBe(sampleDate.toISOString());
    expect(parseDatetimeLocalToIso("")).toBeNull();
    expect(parseDatetimeLocalToIso("fecha-invalida")).toBeNull();
  });

  it("valida correctamente el payload de edición (copy, red social y fecha programada)", () => {
    const valid = validatePostEditPayload({
      copy: "  Nuevo copy programado para la semana 🚀  ",
      network: "Facebook",
      scheduledAtLocal: "2026-10-30T10:00",
    });

    expect(valid.valid).toBe(true);
    expect(valid.normalizedCopy).toBe("Nuevo copy programado para la semana 🚀");
    expect(valid.network).toBe("Facebook");
    expect(valid.scheduledIso).toBe(new Date("2026-10-30T10:00").toISOString());
  });

  it("rechaza copy vacío, exceso de caracteres, red social inválida o fecha inválida", () => {
    expect(
      validatePostEditPayload({
        copy: "   ",
        network: "Instagram",
        scheduledAtLocal: "2026-10-30T10:00",
      }).valid,
    ).toBe(false);

    expect(
      validatePostEditPayload({
        copy: "a".repeat(MAX_POST_COPY_LENGTH + 1),
        network: "Instagram",
        scheduledAtLocal: "2026-10-30T10:00",
      }).valid,
    ).toBe(false);

    expect(
      validatePostEditPayload({
        copy: "Copy válido",
        network: "TikTok",
        scheduledAtLocal: "2026-10-30T10:00",
      }).valid,
    ).toBe(false);

    expect(
      validatePostEditPayload({
        copy: "Copy válido",
        network: "Instagram",
        scheduledAtLocal: "",
      }).valid,
    ).toBe(false);
  });
});
