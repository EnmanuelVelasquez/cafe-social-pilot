import { describe, expect, it } from "vitest";

import {
  LOW_STOCK_THRESHOLD,
  MAX_ASSET_SIZE_BYTES,
  MAX_POST_COPY_LENGTH,
  MIN_ASSET_DIMENSION_PX,
  assets,
  countPublishedThisMonth,
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
  validateImageDimensions,
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

  it("cuenta las publicaciones con estado publicado del mes actual y devuelve 0 si no hay ninguna", () => {
    const refDate = new Date("2026-10-26T12:00:00.000Z");

    expect(countPublishedThisMonth([], refDate)).toBe(0);
    expect(
      countPublishedThisMonth(
        [
          { status: "pendiente", scheduledAtIso: "2026-10-20T10:00:00.000Z" },
          { status: "programado", scheduledAtIso: "2026-10-25T10:00:00.000Z" },
        ],
        refDate,
      ),
    ).toBe(0);

    expect(
      countPublishedThisMonth(
        [
          { status: "publicado", scheduledAtIso: "2026-10-15T10:00:00.000Z" },
          { status: "publicada", scheduledAtIso: "2026-10-21T10:00:00.000Z" },
          { status: "publicado", scheduledAtIso: "2026-09-15T10:00:00.000Z" },
        ],
        refDate,
      ),
    ).toBe(2);
  });
});

describe("Validación de dimensiones y relación de aspecto para Meta Graph API (Fase C - REQ-2.1)", () => {
  it("acepta proporciones oficiales de Feed (4:5 vertical, 1:1 cuadrado, 1.91:1 horizontal) y Stories (9:16)", () => {
    expect(MIN_ASSET_DIMENSION_PX).toBe(320);

    // 4:5 vertical (1080×1350 -> ratio 0.8)
    const verticalFeed = validateImageDimensions(1080, 1350);
    expect(verticalFeed.valid).toBe(true);
    expect(verticalFeed.format).toBe("FEED");

    // 1:1 cuadrado (1080×1080 -> ratio 1.0)
    const squareFeed = validateImageDimensions(1080, 1080);
    expect(squareFeed.valid).toBe(true);
    expect(squareFeed.format).toBe("FEED");

    // 1.91:1 horizontal (1200×628 -> ratio ~1.9108, dentro del 5% de tolerancia)
    const landscapeFeed = validateImageDimensions(1200, 628);
    expect(landscapeFeed.valid).toBe(true);
    expect(landscapeFeed.format).toBe("FEED");

    // 9:16 Stories / Reels (1080×1920 -> ratio 0.5625)
    const story = validateImageDimensions(1080, 1920);
    expect(story.valid).toBe(true);
    expect(story.format).toBe("STORY");
  });

  it("rechaza imágenes con resolución menor a 320×320 px o dimensiones inválidas", () => {
    const tooSmall = validateImageDimensions(280, 280);
    expect(tooSmall.valid).toBe(false);
    expect(tooSmall.reason).toContain("320×320");

    expect(validateImageDimensions(0, 1080).valid).toBe(false);
    expect(validateImageDimensions(-100, 500).valid).toBe(false);
  });

  it("rechaza imágenes fuera de los rangos de aspecto permitidos por Meta API", () => {
    // Panorámica extrema (3:1 -> ratio 3.0)
    const ultraWide = validateImageDimensions(2400, 800);
    expect(ultraWide.valid).toBe(false);
    expect(ultraWide.reason).toContain("Relación de aspecto no compatible");

    // Captura demasiado alargada (ratio 0.35, más estrecha que 9:16)
    const ultraTall = validateImageDimensions(700, 2000);
    expect(ultraTall.valid).toBe(false);

    // Proporción 2:3 (ratio 0.6667, fuera tanto de Stories 9:16 como de Feed 4:5)
    const twoByThree = validateImageDimensions(1000, 1500);
    expect(twoByThree.valid).toBe(false);
  });
});
