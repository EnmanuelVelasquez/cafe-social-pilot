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

/** Dimensión mínima en píxeles exigida por Meta Graph API (REQ-2.1). */
export const MIN_ASSET_DIMENSION_PX = 320;

/** Rango oficial de relación de aspecto (ancho / alto) para Feed de Meta: 4:5 (0.8) a 1.91:1 (1.91). */
export const META_FEED_MIN_ASPECT_RATIO = 4 / 5;
export const META_FEED_MAX_ASPECT_RATIO = 1.91;

/** Relación de aspecto oficial para Stories / Reels de Meta: 9:16 (0.5625). */
export const META_STORY_ASPECT_RATIO = 9 / 16;

/** Tolerancia del 5% para variaciones menores de recorte en cámara o exportación. */
export const META_ASPECT_RATIO_TOLERANCE = 0.05;

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

export interface ImageDimensionValidationResult {
  valid: boolean;
  aspectRatio?: number | undefined;
  format?: "FEED" | "STORY" | undefined;
  reason?: string | undefined;
}

/**
 * Fase C (REQ-2.1): Valida que el ancho, alto y relación de aspecto (`width / height`)
 * de una imagen cumplan con los rangos permitidos por Meta Graph API:
 * - Resolución mínima de 320×320 px.
 * - Feed: entre 4:5 (0.8) y 1.91:1 (incluyendo 1:1 cuadrado), con 5% de tolerancia.
 * - Stories: 9:16 (0.5625), con 5% de tolerancia.
 */
export function validateImageDimensions(
  width: number,
  height: number,
): ImageDimensionValidationResult {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return {
      valid: false,
      reason: "No se pudieron leer las dimensiones de la imagen.",
    };
  }

  if (width < MIN_ASSET_DIMENSION_PX || height < MIN_ASSET_DIMENSION_PX) {
    return {
      valid: false,
      reason: `Resolución insuficiente (${Math.round(width)}×${Math.round(height)} px). Meta API exige un mínimo de ${MIN_ASSET_DIMENSION_PX}×${MIN_ASSET_DIMENSION_PX} px.`,
    };
  }

  const aspectRatio = Number((width / height).toFixed(4));

  const feedMin = META_FEED_MIN_ASPECT_RATIO * (1 - META_ASPECT_RATIO_TOLERANCE);
  const feedMax = META_FEED_MAX_ASPECT_RATIO * (1 + META_ASPECT_RATIO_TOLERANCE);

  const storyMin = META_STORY_ASPECT_RATIO * (1 - META_ASPECT_RATIO_TOLERANCE);
  const storyMax = META_STORY_ASPECT_RATIO * (1 + META_ASPECT_RATIO_TOLERANCE);

  if (aspectRatio >= feedMin && aspectRatio <= feedMax) {
    return {
      valid: true,
      aspectRatio,
      format: "FEED",
    };
  }

  if (aspectRatio >= storyMin && aspectRatio <= storyMax) {
    return {
      valid: true,
      aspectRatio,
      format: "STORY",
    };
  }

  return {
    valid: false,
    aspectRatio,
    reason: `Relación de aspecto no compatible con Meta API (${Math.round(width)}×${Math.round(height)} px, proporción ${aspectRatio.toFixed(2)}:1). Usa formato Feed (4:5 vertical, 1:1 cuadrado o hasta 1.91:1 horizontal) o Stories (9:16).`,
  };
}

/**
 * Lee las dimensiones reales (`naturalWidth` y `naturalHeight`) de un archivo de imagen en el navegador
 * antes de subirlo a Supabase Storage.
 */
export function readImageDimensions(
  file: Blob,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    if (typeof Image === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) {
      reject(new Error("API de inspección de imagen no disponible en este entorno."));
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      URL.revokeObjectURL(objectUrl);
      resolve({ width, height });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("El archivo de imagen está dañado o no se pudo decodificar."));
    };

    img.src = objectUrl;
  });
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

/**
 * Verifica que una mutación (DELETE o UPDATE con `.select()`) en Supabase haya afectado al menos 1 fila.
 * Cuando falta una política RLS (ej. DELETE o UPDATE en `activos`), PostgREST devuelve `error: null` y `data: []`.
 */
export function hasAffectedRows(rows: unknown[] | null | undefined): boolean {
  return Array.isArray(rows) && rows.length > 0;
}

export const SUPPORTED_SOCIAL_NETWORKS = ["Instagram", "Facebook"] as const;
export type SocialNetwork = (typeof SUPPORTED_SOCIAL_NETWORKS)[number];

/** Límite máximo de caracteres permitido para el copy de una publicación en Meta. */
export const MAX_POST_COPY_LENGTH = 2200;

/**
 * Convierte una fecha ISO o instancia `Date` al formato `YYYY-MM-DDTHH:mm`
 * requerido por `<input type="datetime-local" />` en la zona horaria local.
 */
export function toDatetimeLocalInputValue(
  isoOrDate: string | Date | null | undefined,
  fallbackNow: Date = new Date(),
): string {
  let d: Date;
  if (isoOrDate instanceof Date) {
    d = isoOrDate;
  } else if (typeof isoOrDate === "string" && isoOrDate.trim()) {
    const parsed = new Date(isoOrDate);
    d = Number.isNaN(parsed.getTime()) ? fallbackNow : parsed;
  } else {
    d = fallbackNow;
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Parsea y valida un valor de `<input type="datetime-local" />` devolviendo su representación ISO 8601
 * para guardar en `publicaciones.fecha_publicacion`, o `null` si la fecha es inválida.
 */
export function parseDatetimeLocalToIso(datetimeLocalValue: string): string | null {
  const cleaned = datetimeLocalValue.trim();
  if (!cleaned) return null;
  const parsed = new Date(cleaned);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/**
 * Formatea una fecha ISO en etiqueta legible (`es-CO`) para mostrar en la tarjeta de publicación.
 */
export function formatScheduledDateLabel(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleString("es-CO", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export interface PostEditValidationResult {
  valid: boolean;
  reason?: string | undefined;
  normalizedCopy?: string | undefined;
  network?: SocialNetwork | undefined;
  scheduledIso?: string | undefined;
}

/**
 * Fase B: Valida los campos editados de una publicación (copy, red social y fecha/hora programada)
 * antes de persistirlos en la tabla `publicaciones` de Supabase.
 */
export function validatePostEditPayload(input: {
  copy: string;
  network: string;
  scheduledAtLocal: string;
}): PostEditValidationResult {
  const normalizedCopy = input.copy.trim();
  if (!normalizedCopy) {
    return {
      valid: false,
      reason: "El texto de la publicación no puede quedar vacío.",
    };
  }

  if (normalizedCopy.length > MAX_POST_COPY_LENGTH) {
    return {
      valid: false,
      reason: `El texto supera el máximo de ${MAX_POST_COPY_LENGTH} caracteres permitido.`,
    };
  }

  if (
    !SUPPORTED_SOCIAL_NETWORKS.includes(
      input.network as (typeof SUPPORTED_SOCIAL_NETWORKS)[number],
    )
  ) {
    return {
      valid: false,
      reason: "Selecciona una red social válida (Instagram o Facebook).",
    };
  }

  const scheduledIso = parseDatetimeLocalToIso(input.scheduledAtLocal);
  if (!scheduledIso) {
    return {
      valid: false,
      reason: "Selecciona una fecha y hora de publicación válida.",
    };
  }

  return {
    valid: true,
    normalizedCopy,
    network: input.network as SocialNetwork,
    scheduledIso,
  };
}

/**
 * Cuenta cuántas publicaciones de la sucursal tienen estado `publicado` / `publicada`
 * dentro del mes y año de referencia (`now`). Si no hay ninguna, devuelve `0`.
 */
export function countPublishedThisMonth(
  list: ReadonlyArray<{ status: string; scheduledAtIso?: string | null | undefined }>,
  now: Date = new Date(),
): number {
  const targetYear = now.getFullYear();
  const targetMonth = now.getMonth();

  return list.filter((item) => {
    const normalizedStatus = item.status.trim().toLowerCase();
    if (normalizedStatus !== "publicado" && normalizedStatus !== "publicada") {
      return false;
    }
    if (!item.scheduledAtIso) {
      return true;
    }
    const parsed = new Date(item.scheduledAtIso);
    if (Number.isNaN(parsed.getTime())) {
      return true;
    }
    return parsed.getFullYear() === targetYear && parsed.getMonth() === targetMonth;
  }).length;
}
