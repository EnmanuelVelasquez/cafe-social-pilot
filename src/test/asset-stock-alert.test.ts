import { describe, expect, it } from "vitest";

import {
  LOW_STOCK_THRESHOLD,
  assets,
  countUnused,
  isLowStock,
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

describe("Alerta de banco de activos bajo", () => {
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
});
