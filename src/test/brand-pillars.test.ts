import { describe, expect, it } from "vitest";

import { TOTAL_SHARE, setPillarValue, type Pillar } from "@/lib/brand";

const base: Pillar[] = [
  { name: "Educativo", value: 40 },
  { name: "Venta", value: 30 },
  { name: "Estilo de vida", value: 30 },
];
const total = (ps: Pillar[]) => ps.reduce((a, p) => a + p.value, 0);

describe("Pilares de contenido siempre suman 100%", () => {
  it("el total objetivo es 100", () => {
    expect(TOTAL_SHARE).toBe(100);
  });

  it("sube un pilar robando proporcionalmente a los demás", () => {
    const next = setPillarValue(base, 0, 60);

    expect(next.map((p) => p.value)).toEqual([60, 20, 20]);
    expect(total(next)).toBe(100);
  });

  it("no deja decimales ni deriva de redondeo al repartir", () => {
    const next = setPillarValue(base, 0, 33);

    next.forEach((p) => expect(Number.isInteger(p.value)).toBe(true));
    expect(total(next)).toBe(100);
  });

  it("no deja subir de 100 ni bajar de 0", () => {
    const up = setPillarValue(base, 0, 140);
    const down = setPillarValue(base, 0, -20);

    expect(up.at(0)?.value).toBe(100);
    expect(total(up)).toBe(100);
    expect(down.at(0)?.value).toBe(0);
    expect(total(down)).toBe(100);
  });

  it("reparte a partes iguales si los demás pilares están en 0", () => {
    const next = setPillarValue(
      [
        { name: "A", value: 100 },
        { name: "B", value: 0 },
        { name: "C", value: 0 },
      ],
      0,
      50,
    );

    expect(next.map((p) => p.value)).toEqual([50, 25, 25]);
  });

  it("sigue sumando 100 tras varios movimientos seguidos", () => {
    let ps = base;
    for (const [i, v] of [
      [1, 5],
      [2, 70],
      [0, 15],
      [1, 50],
    ] as const) {
      ps = setPillarValue(ps, i, v);
    }

    expect(total(ps)).toBe(100);
    ps.forEach((p) => expect(Number.isInteger(p.value)).toBe(true));
  });
});
