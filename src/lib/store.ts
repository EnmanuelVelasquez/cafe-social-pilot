import { create } from "zustand";
import type { Sucursal } from "@/types";

/**
 * Calcula la nueva lista de sucursales y la siguiente sucursal activa tras eliminar una sede.
 * Si la sucursal eliminada era la activa, selecciona automáticamente la primera disponible o `null`.
 */
export function resolveNextBranchStateAfterDelete(
  sucursales: Sucursal[],
  deletedId: string,
  currentActive: Sucursal | null = null,
): { sucursales: Sucursal[]; sucursalActiva: Sucursal | null } {
  const nextSucursales = sucursales.filter((s) => s.id !== deletedId);
  if (nextSucursales.length === 0) {
    return { sucursales: [], sucursalActiva: null };
  }

  const stillExists =
    currentActive !== null &&
    currentActive.id !== deletedId &&
    nextSucursales.some((s) => s.id === currentActive.id);

  return {
    sucursales: nextSucursales,
    sucursalActiva: stillExists ? currentActive : (nextSucursales[0] ?? null),
  };
}

export interface BranchState {
  sucursales: Sucursal[];
  sucursalActiva: Sucursal | null;
  setSucursales: (sucursales: Sucursal[]) => void;
  setSucursalActiva: (sucursalActiva: Sucursal | null) => void;
  removeSucursal: (deletedId: string) => void;
}

export const useBranchStore = create<BranchState>()((set) => ({
  sucursales: [],
  sucursalActiva: null,
  setSucursales: (sucursales) => set({ sucursales }),
  setSucursalActiva: (sucursalActiva) => set({ sucursalActiva }),
  removeSucursal: (deletedId) =>
    set((state) =>
      resolveNextBranchStateAfterDelete(
        state.sucursales,
        deletedId,
        state.sucursalActiva,
      ),
    ),
}));
