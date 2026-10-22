import a1 from "@/assets/a1.jpg";
import a2 from "@/assets/a2.jpg";
import a3 from "@/assets/a3.jpg";
import a4 from "@/assets/a4.jpg";
import type { Sucursal } from "@/types";

export const sampleBranches: Sucursal[] = [
  {
    id: "centro",
    perfil_id: "perfil-1",
    nombre: "Sede Centro",
    tono: "Cercano",
    reglas_negativas: 'Nunca mencionar a la competencia. No usar las palabras "barato" ni "instantáneo". No hacer promesas de salud.',
  },
  {
    id: "norte",
    perfil_id: "perfil-1",
    nombre: "Sede Norte",
    tono: "Profesional",
    reglas_negativas: 'Nunca mencionar a la competencia. Evitar jerga informal.',
  },
];

export type Status = "pendiente" | "programado";
export interface Post {
  id: number;
  img: string;
  network: "Instagram" | "Facebook";
  when: string;
  pillar: string;
  copy: string;
  status: Status;
}

export const posts: Post[] = [
  { id: 1, img: a1, network: "Instagram", when: "Hoy · 5:00 PM", pillar: "Estilo de vida", copy: "¡Comienza tu mañana con el mejor aroma de origen! ☕ Pide el tuyo en el link de la bio. #CaféColombiano #Desayuno", status: "pendiente" },
  { id: 2, img: a2, network: "Facebook", when: "Mañana · 8:00 AM", pillar: "Venta", copy: "Nuestro tostado medio 100% arábica ahora con 15% de descuento 🎉 Solo hasta el domingo. Envíos a toda Colombia. #CaféDonJuan #Oferta", status: "pendiente" },
  { id: 3, img: a4, network: "Instagram", when: "Mañana · 12:30 PM", pillar: "Educativo", copy: "¿Sabías que cada grano se recolecta a mano en las montañas del Huila? 🌱 Así nace el sabor que amas. #OrigenHuila #CaféDeEspecialidad", status: "programado" },
  { id: 4, img: a3, network: "Facebook", when: "Sáb 12 oct · 10:00 AM", pillar: "Estilo de vida", copy: "Los mejores planes empiezan con una buena taza y mejor compañía ☕💬 Te esperamos este fin de semana. #PlanDeFinde #CaféConAmigos", status: "programado" },
  { id: 5, img: a1, network: "Instagram", when: "Dom 13 oct · 7:00 PM", pillar: "Educativo", copy: "3 tips para preparar el café perfecto en casa: agua a 92°C, molienda media y mucho amor ❤️ #TipsDeCafé #BaristaEnCasa", status: "pendiente" },
];

export interface Asset { id: number | string; img: string; name: string; tags: string[]; uses: number }
export const assets: Asset[] = [
  { id: 1, img: a1, name: "Taza latte art", tags: ["#producto", "#ambiente"], uses: 12 },
  { id: 2, img: a2, name: "Empaque tostado medio", tags: ["#producto", "#oferta"], uses: 8 },
  { id: 3, img: a3, name: "Tienda Chapinero", tags: ["#ambiente", "#comunidad"], uses: 5 },
  { id: 4, img: a4, name: "Cosecha Huila", tags: ["#origen", "#educativo"], uses: 3 },
  { id: 5, img: a2, name: "Bolsa grano entero", tags: ["#producto"], uses: 0 },
  { id: 6, img: a1, name: "Desayuno de domingo", tags: ["#ambiente", "#oferta"], uses: 7 },
  { id: 7, img: a4, name: "Cerezas maduras", tags: ["#origen"], uses: 2 },
  { id: 8, img: a3, name: "Clientes felices", tags: ["#comunidad", "#ambiente"], uses: 4 },
];

/** La IA se queda sin material fresco cuando quedan menos de este número de imágenes sin usar. */
export const LOW_STOCK_THRESHOLD = 5;

/** Límite máximo de archivo permitido por Meta Graph API (8 MB - REQ-2.1). */
export const MAX_ASSET_SIZE_BYTES = 8 * 1024 * 1024;

/** Formatos de imagen soportados por Meta Graph API (REQ-2.1). */
export const ALLOWED_ASSET_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const countUnused = (list: Asset[]) => list.filter((a) => a.uses === 0).length;

export const isLowStock = (list: Asset[]) => countUnused(list) < LOW_STOCK_THRESHOLD;

/** Riesgo 1 (Inventario Cero): No hay ningún activo disponible para publicar. */
export const isZeroInventory = (list: Asset[] | number) =>
  typeof list === "number" ? list <= 0 : list.length === 0;

export interface AssetValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * REQ-2.1: Valida que el archivo cumpla formato MIME y peso máximo (8 MB) de Meta Graph API.
 */
export function validateAssetFile(file: { size: number; type: string }): AssetValidationResult {
  if (file.size <= 0) {
    return { valid: false, reason: "El archivo está vacío." };
  }
  if (!ALLOWED_ASSET_MIME_TYPES.includes(file.type as (typeof ALLOWED_ASSET_MIME_TYPES)[number])) {
    return {
      valid: false,
      reason: "Formato no permitido por Meta API. Usa imágenes JPG, PNG o WEBP.",
    };
  }
  if (file.size > MAX_ASSET_SIZE_BYTES) {
    return {
      valid: false,
      reason: "La imagen supera el límite de 8 MB permitido por Meta API.",
    };
  }
  return { valid: true };
}

/**
 * Extrae la ruta interna del objeto en Supabase Storage a partir de su URL pública.
 */
export function extractStoragePath(publicUrl: string, bucket = "galeria"): string | null {
  if (!publicUrl) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  const rawPath = publicUrl.slice(idx + marker.length).split("?")[0];
  return rawPath ? decodeURIComponent(rawPath) : null;
}

/**
 * Convierte el campo `tags` de Supabase (texto separado por comas o arreglo) en lista de etiquetas.
 */
export function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t).trim()).filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Normaliza y serializa una lista de etiquetas separadas por coma para guardar en `activos.tags`.
 */
export function formatTagsString(rawInput: string): string {
  const tags = parseTags(rawInput).map((t) => (t.startsWith("#") ? t.toLowerCase() : `#${t.toLowerCase()}`));
  return Array.from(new Set(tags)).join(", ");
}

/**
 * REQ-2.2: Genera etiquetas iniciales a partir del nombre del archivo cuando se sube un activo.
 */
export function inferTagsFromFilename(filename: string): string[] {
  const base = filename.replace(/\.[^.]+$/, "").toLowerCase();
  const stopWords = new Set(["img", "image", "foto", "photo", "whatsapp", "screenshot", "captura", "dsc", "pxl"]);
  const tokens = base
    .split(/[^a-záéíóúñ0-9]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !stopWords.has(t));

  if (tokens.length === 0) {
    return ["#producto", "#ambiente"];
  }
  return Array.from(new Set(tokens.slice(0, 4).map((t) => `#${t}`)));
}
