import a1 from "@/assets/a1.jpg";
import a2 from "@/assets/a2.jpg";
import a3 from "@/assets/a3.jpg";
import a4 from "@/assets/a4.jpg";

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

export interface Asset { id: number; img: string; name: string; tags: string[]; uses: number }
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

export const countUnused = (list: Asset[]) => list.filter((a) => a.uses === 0).length;

export const isLowStock = (list: Asset[]) => countUnused(list) < LOW_STOCK_THRESHOLD;
