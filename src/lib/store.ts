import { create } from "zustand";
import type { Sucursal } from "@/types";

export interface BranchState {
  sucursales: Sucursal[];
  sucursalActiva: Sucursal | null;
  setSucursales: (sucursales: Sucursal[]) => void;
  setSucursalActiva: (sucursalActiva: Sucursal | null) => void;
}

export const useBranchStore = create<BranchState>()((set) => ({
  sucursales: [],
  sucursalActiva: null,
  setSucursales: (sucursales) => set({ sucursales }),
  setSucursalActiva: (sucursalActiva) => set({ sucursalActiva }),
}));
