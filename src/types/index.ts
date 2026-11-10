export interface Perfil {
  id: string;
  nombre: string;
  created_at?: string;
}

/**
 * Identidad visual declarada por la marca. Todos los campos son opcionales:
 * una sucursal puede no tener Brand Kit y la app debe seguir funcionando.
 */
export interface BrandKit {
  primary_color?: string | undefined;
  secondary_color?: string | undefined;
  accent_color?: string | undefined;
  visual_style?: string | undefined;
  /** Reserva una zona limpia en la composición para superponer el logo. */
  reserve_logo_space?: boolean | undefined;
}

export interface Sucursal {
  id: string;
  perfil_id: string;
  nombre: string;
  tono: string;
  reglas_negativas: string;
  /** Columna opcional `sucursales.brand_kit` (JSONB). Puede venir null o ausente. */
  brand_kit?: BrandKit | null | undefined;
  created_at?: string;
}

export interface Activo {
  id: string;
  sucursal_id: string;
  url_imagen: string;
  tags: string;
  contador_uso?: number;
  created_at?: string;
}

export type PublishStatus =
  | "pendiente"
  | "programado"
  | "publicando"
  | "publicado"
  | "error";

export interface Publicacion {
  id: string;
  sucursal_id: string;
  texto_copy: string;
  fecha_publicacion: string;
  red_social: string;
  estado: string;
  activo_id: string;
  ultimo_error?: string | null | undefined;
  intentos?: number | undefined;
  publicado_en?: string | null | undefined;
  id_externo?: string | null | undefined;
  created_at?: string;
}

export interface IntegracionSocial {
  id: string;
  sucursal_id: string;
  plataforma: string;
  token_cifrado: string | null;
  page_id?: string | null | undefined;
  ig_user_id?: string | null | undefined;
  token_expira_en?: string | null | undefined;
  created_at?: string;
}

