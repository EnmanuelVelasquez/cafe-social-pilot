export interface Pillar {
  name: string;
  value: number;
}

/** La mezcla de pilares siempre debe sumar este total. */
export const TOTAL_SHARE = 100;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * Ajusta un pilar y reparte el resto entre los demás para que la mezcla
 * siga sumando 100% exactos, sin decimales ni deriva de redondeo.
 */
export function setPillarValue(pillars: Pillar[], index: number, value: number): Pillar[] {
  if (pillars.length === 0) return pillars;
  if (index < 0 || index >= pillars.length) return pillars;
  if (pillars.length === 1) return [{ ...pillars[0], value: TOTAL_SHARE }];

  const target = clamp(Math.round(value), 0, TOTAL_SHARE);
  const remaining = TOTAL_SHARE - target;
  const others = pillars.filter((_, i) => i !== index).map((p) => clamp(Math.round(p.value), 0, TOTAL_SHARE));
  const othersTotal = others.reduce((a, b) => a + b, 0);

  // Reparto proporcional al peso actual; si nadie tiene peso, se reparte a partes iguales.
  const raw = others.map((v) => (othersTotal > 0 ? (v * remaining) / othersTotal : remaining / others.length));
  const shares = raw.map(Math.floor);
  let drift = remaining - shares.reduce((a, b) => a + b, 0);
  const byFraction = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of byFraction) {
    if (drift <= 0) break;
    shares[i] += 1;
    drift -= 1;
  }

  let next = -1;
  return pillars.map((p, i) => {
    if (i === index) return { ...p, value: target };
    next += 1;
    return { ...p, value: shares[next] };
  });
}
