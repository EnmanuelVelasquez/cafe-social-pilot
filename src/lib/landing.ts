export interface LandingPainPoint {
  id: string;
  title: string;
  description: string;
}

export interface LandingBenefit {
  id: "tiempo" | "plata" | "tranquilidad";
  label: string;
  title: string;
  description: string;
}

export interface LandingPlan {
  id: "emprendedor" | "negocio";
  name: string;
  priceMonthlyCop: number;
  priceLabel: string;
  periodLabel: string;
  badge?: string | undefined;
  summary: string;
  features: readonly string[];
  highlighted?: boolean | undefined;
}

export const DEFAULT_WHATSAPP_PHONE = "573000000000";
export const DEFAULT_WHATSAPP_MESSAGE =
  "Hola, quiero ver cómo AutoSocial AI puede organizar las publicaciones semanales de mi negocio.";

export const LANDING_PAIN_POINTS: readonly LandingPainPoint[] = [
  {
    id: "noches",
    title: "Son las 11 p. m. y no has publicado nada",
    description:
      "Llegas cansado después de atender clientes todo el día y te quedas frente al celular sin saber qué escribir ni qué foto subir para mañana.",
  },
  {
    id: "silencio",
    title: "Dejas pasar días en silencio y pierdes pedidos",
    description:
      "Cuando tu Instagram o Facebook pasan varios días sin actividad, tus clientes dudan si sigues atendiendo y terminan escribiéndole a la competencia.",
  },
  {
    id: "agencia",
    title: "Una agencia cuesta $1.200.000/mes y delegar falla",
    description:
      "Pagar una agencia se sale de presupuesto, pero dejarle las redes a alguien sin guía hace que publiquen mensajes fríos que no suenan a tu negocio.",
  },
];

export const LANDING_BENEFITS: readonly LandingBenefit[] = [
  {
    id: "tiempo",
    label: "Tiempo",
    title: "Tu semana lista en 10 minutos",
    description:
      "Organiza textos, fotos y fechas de toda la semana de una sola sentada y olvídate de trasnocharte buscando qué subir cada noche.",
  },
  {
    id: "plata",
    label: "Plata",
    title: "Visible todos los días por una fracción de una agencia",
    description:
      "Mantén tus vitrinas activas para atraer consultas y ventas diarias sin comprometer tu flujo de caja mensual.",
  },
  {
    id: "tranquilidad",
    label: "Tranquilidad",
    title: "Siempre con la voz y las reglas de tu negocio",
    description:
      "Tus publicaciones respetan tus palabras prohibidas y tu estilo. Solo copias el texto, descargas la foto y publicas sin enredos.",
  },
];

export const LANDING_PROOF_QUOTE = {
  quote: "Entre menos trabajo tengas que hacer, siento que mejor fluyen las cosas.",
  author: "Dueño de negocio gastronómico",
  context: "Entrevista real de validación · Piloto activo con Café Don Juan",
} as const;

export const LANDING_PLANS: readonly LandingPlan[] = [
  {
    id: "emprendedor",
    name: "Plan Emprendedor",
    priceMonthlyCop: 49_000,
    priceLabel: "$49.000 COP",
    periodLabel: "/ mes",
    badge: "Ideal para empezar",
    summary: "Para un negocio o punto de venta que quiere constancia semanal sin complicarse.",
    highlighted: true,
    features: [
      "1 sucursal con voz, tono y palabras prohibidas propias",
      "Textos y calendario semanal listos para aprobar",
      "Banco organizado de fotos + ideas visuales semanales",
      "Publicación Manual Asistida: copiar, descargar y control mensual",
      "Sin contratos de permanencia ni costos ocultos",
    ],
  },
  {
    id: "negocio",
    name: "Plan Negocio",
    priceMonthlyCop: 89_000,
    priceLabel: "$89.000 COP",
    periodLabel: "/ mes",
    summary: "Para negocios con varias sedes o líneas que necesitan orden y acompañamiento.",
    features: [
      "Hasta 3 sucursales independientes en la misma cuenta",
      "Paleta, estilo visual y pilares propios por cada sede",
      "Control de rotación de fotos para no repetir imágenes",
      "Acompañamiento directo por WhatsApp para puesta en marcha",
      "Conexión directa Meta opcional para negocios autorizados",
    ],
  },
];

/**
 * Normaliza un número de WhatsApp dejado en variable de entorno o usa el número por defecto.
 * Si recibe un celular colombiano de 10 dígitos (ej. `3001234567`), antepone `57`.
 */
export function resolveWhatsAppPhone(rawPhone?: string | null | undefined): string {
  const fromEnv =
    rawPhone ??
    (typeof import.meta !== "undefined"
      ? (import.meta.env?.["VITE_WHATSAPP_NUMBER"] as string | undefined)
      : undefined);

  const digits = (fromEnv ?? "").replace(/\D+/g, "");
  if (!digits) {
    return DEFAULT_WHATSAPP_PHONE;
  }
  if (digits.length === 10 && digits.startsWith("3")) {
    return `57${digits}`;
  }
  if (digits.length < 8) {
    return DEFAULT_WHATSAPP_PHONE;
  }
  return digits;
}

/**
 * Construye el enlace oficial `https://wa.me/...` con mensaje prellenado listo para abrir WhatsApp.
 */
export function buildWhatsAppLeadUrl(options?: {
  phone?: string | null | undefined;
  planName?: string | undefined;
  message?: string | undefined;
}): string {
  const phone = resolveWhatsAppPhone(options?.phone);
  const customMessage = options?.message?.trim();
  const baseMessage = customMessage
    ? customMessage
    : options?.planName?.trim()
      ? `Hola, me interesa el ${options.planName.trim()} de AutoSocial AI para mi negocio. ¿Cómo empezamos?`
      : DEFAULT_WHATSAPP_MESSAGE;

  return `https://wa.me/${phone}?text=${encodeURIComponent(baseMessage)}`;
}
