import { beforeEach, describe, expect, it } from "vitest";
import { resolveNextBranchStateAfterDelete, useBranchStore } from "@/lib/store";
import type { Sucursal } from "@/types";

const sampleBranches: Sucursal[] = [
  {
    id: "suc-1",
    perfil_id: "perf-1",
    nombre: "Sede Centro",
    tono: "Cercano",
    reglas_negativas: "No mencionar competencia",
  },
  {
    id: "suc-2",
    perfil_id: "perf-1",
    nombre: "Sede Norte",
    tono: "Profesional",
    reglas_negativas: "No usar la palabra barato",
  },
];

describe("useBranchStore", () => {
  beforeEach(() => {
    useBranchStore.setState({
      sucursales: [],
      sucursalActiva: null,
    });
  });

  it("inicia con sucursales vacías y sucursalActiva en null", () => {
    const state = useBranchStore.getState();
    expect(state.sucursales).toEqual([]);
    expect(state.sucursalActiva).toBeNull();
  });

  it("actualiza la lista de sucursales con setSucursales", () => {
    useBranchStore.getState().setSucursales(sampleBranches);
    expect(useBranchStore.getState().sucursales).toEqual(sampleBranches);
  });

  it("actualiza la sucursal activa con setSucursalActiva y permite limpiarla a null", () => {
    const first = sampleBranches[0]!;
    useBranchStore.getState().setSucursalActiva(first);
    expect(useBranchStore.getState().sucursalActiva).toEqual(first);

    useBranchStore.getState().setSucursalActiva(null);
    expect(useBranchStore.getState().sucursalActiva).toBeNull();
  });

  it("elimina la sucursal activa con removeSucursal y selecciona automáticamente la siguiente disponible", () => {
    useBranchStore.getState().setSucursales(sampleBranches);
    useBranchStore.getState().setSucursalActiva(sampleBranches[0]!);

    useBranchStore.getState().removeSucursal("suc-1");

    const stateAfterFirstDelete = useBranchStore.getState();
    expect(stateAfterFirstDelete.sucursales).toEqual([sampleBranches[1]!]);
    expect(stateAfterFirstDelete.sucursalActiva).toEqual(sampleBranches[1]!);

    useBranchStore.getState().removeSucursal("suc-2");

    const stateAfterAllDeleted = useBranchStore.getState();
    expect(stateAfterAllDeleted.sucursales).toEqual([]);
    expect(stateAfterAllDeleted.sucursalActiva).toBeNull();
  });

  it("mantiene la sucursal activa actual si se elimina otra sucursal distinta", () => {
    const next = resolveNextBranchStateAfterDelete(
      sampleBranches,
      "suc-1",
      sampleBranches[1]!,
    );
    expect(next.sucursales).toEqual([sampleBranches[1]!]);
    expect(next.sucursalActiva).toEqual(sampleBranches[1]!);
  });
});
