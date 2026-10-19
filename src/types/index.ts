export interface Perfil {
  id: string;
  nombre: string;
}

export interface Sucursal {
  id: string;
  perfil_id: string;
  nombre: string;
  tono: string;
  reglas_negativas: string;
}

export interface Activo {
  id: string;
  sucursal_id: string;
  url_imagen: string;
  tags: string;
  contador_uso?: number;
}

export interface Publicacion {
  id: string;
  sucursal_id: string;
  texto_copy: string;
  fecha_publicacion: string;
  red_social: string;
  estado: string;
  activo_id: string;
}
