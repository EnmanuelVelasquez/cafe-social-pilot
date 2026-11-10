import type { BrandKit, Sucursal } from "@/types";

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
  if (pillars.length === 1) return pillars.map((p) => ({ ...p, value: TOTAL_SHARE }));

  const target = clamp(Math.round(value), 0, TOTAL_SHARE);
  const remaining = TOTAL_SHARE - target;
  const others = pillars
    .filter((_, i) => i !== index)
    .map((p) => clamp(Math.round(p.value), 0, TOTAL_SHARE));
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
    shares[i] = (shares[i] ?? 0) + 1;
    drift -= 1;
  }

  let next = -1;
  return pillars.map((p, i) =>
    i === index ? { ...p, value: target } : { ...p, value: shares[++next] ?? 0 },
  );
}

/**
 * REQ-1.2 (Brand Guardrails): Construye el prompt de sistema inyectando siempre al final
 * la cláusula obligatoria de Reglas Negativas.
 */
export function buildBrandSystemPrompt(
  branch: Pick<Sucursal, "nombre" | "tono" | "reglas_negativas">,
  pillars: Pillar[] = [],
): string {
  const cleanRules = branch.reglas_negativas.trim();
  const pillarsSummary =
    pillars.length >= 2
      ? `Distribución de pilares: ${pillars.map((p) => `${p.name} (${p.value}%)`).join(", ")}.`
      : "";

  return [
    `Eres el asistente de marketing de la marca "${branch.nombre}".`,
    `Tono de comunicación obligatorio: ${branch.tono || "Cercano"}.`,
    pillarsSummary,
    `Bajo ninguna circunstancia debes mencionar o hacer alusión a lo siguiente: [${cleanRules}]`,
  ]
    .filter(Boolean)
    .join(" ");
}

/* ------------------------------------------------------------------------- *
 * Brand Kit (colores, estilo visual y espacio para logo)
 *
 * El Brand Kit es un dato de negocio opcional: cualquier valor ausente,
 * nulo o corrupto debe degradar a `undefined` sin romper la UI ni los prompts.
 * ------------------------------------------------------------------------- */

/** Etiqueta que marca un activo como el logo de la marca. */
export const BRAND_LOGO_TAG = "brand_logo";
/** Etiqueta que marca un activo como referencia visual de la marca. */
export const BRAND_REFERENCE_TAG = "brand_reference";

export const BRAND_TAGS = [BRAND_LOGO_TAG, BRAND_REFERENCE_TAG] as const;
export type BrandTag = (typeof BRAND_TAGS)[number];

const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** Acepta `#RGB`, `#RRGGBB` o el mismo valor sin `#`. Devuelve `#RRGGBB` en mayúsculas. */
function readHexColor(value: unknown): string | undefined {
  const raw = readOptionalString(value);
  if (!raw) return undefined;
  const withHash = raw.startsWith("#") ? raw : `#${raw}`;
  return HEX_COLOR_PATTERN.test(withHash) ? withHash.toUpperCase() : undefined;
}

/**
 * Normaliza `sucursales.brand_kit` (objeto JSONB o string JSON) sin lanzar
 * errores: descarta colores inválidos y campos de otro tipo.
 */
export function normalizeBrandKit(raw: unknown): BrandKit {
  let source: unknown = raw;

  if (typeof raw === "string") {
    try {
      source = JSON.parse(raw);
    } catch {
      return {};
    }
  }

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return {};
  }

  const obj = source as Record<string, unknown>;
  const reserveLogoSpace = obj["reserve_logo_space"];

  return {
    primary_color: readHexColor(obj["primary_color"]),
    secondary_color: readHexColor(obj["secondary_color"]),
    accent_color: readHexColor(obj["accent_color"]),
    visual_style: readOptionalString(obj["visual_style"]),
    reserve_logo_space:
      typeof reserveLogoSpace === "boolean" ? reserveLogoSpace : undefined,
  };
}

/** `true` si el Brand Kit tiene al menos un dato útil declarado. */
export function hasBrandKitData(brandKit: BrandKit | null | undefined): boolean {
  if (!brandKit) return false;
  return Boolean(
    brandKit.primary_color ||
      brandKit.secondary_color ||
      brandKit.accent_color ||
      brandKit.visual_style ||
      brandKit.reserve_logo_space,
  );
}

function toTagList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((tag) => String(tag).trim()).filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeTagToken(tag: string): string {
  return tag.replace(/^#+/, "").trim().toLowerCase();
}

/** `true` si la lista de tags (string separado por comas o arreglo) contiene `tag`. */
export function hasBrandTag(tags: unknown, tag: BrandTag): boolean {
  const target = normalizeTagToken(tag);
  return toTagList(tags).some((candidate) => normalizeTagToken(candidate) === target);
}

/**
 * Devuelve hasta `maxCount` activos marcados como `brand_logo` o
 * `brand_reference`, priorizando siempre los logos.
 */
export function extractBrandReferenceAssets<T extends { tags?: unknown }>(
  assets: T[],
  maxCount = 2,
): T[] {
  const limit = Math.max(0, Math.trunc(maxCount));
  if (limit === 0) return [];

  const logos = assets.filter((asset) => hasBrandTag(asset.tags, BRAND_LOGO_TAG));
  const references = assets.filter(
    (asset) =>
      !hasBrandTag(asset.tags, BRAND_LOGO_TAG) &&
      hasBrandTag(asset.tags, BRAND_REFERENCE_TAG),
  );

  return [...logos, ...references].slice(0, limit);
}

/**
 * Activa o desactiva una etiqueta de marca dentro de un string de tags
 * separado por comas, sin duplicar ni perder las demás etiquetas.
 * Si `enabled` se omite, alterna el estado actual.
 */
export function toggleBrandTag(
  rawTags: string,
  tag: BrandTag,
  enabled?: boolean,
): string {
  const target = normalizeTagToken(tag);
  const current = toTagList(rawTags);
  const alreadyPresent = current.some(
    (candidate) => normalizeTagToken(candidate) === target,
  );
  const shouldEnable = enabled ?? !alreadyPresent;
  const withoutTarget = current.filter(
    (candidate) => normalizeTagToken(candidate) !== target,
  );
  const next = shouldEnable ? [...withoutTarget, `#${target}`] : withoutTarget;

  return Array.from(new Set(next)).join(", ");
}
