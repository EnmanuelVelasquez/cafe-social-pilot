import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  MIN_SIGNUP_PASSWORD_LENGTH,
  deriveProfileDisplayName,
  ensureUserPerfil,
  isMissingUserIdColumnError,
  mapSupabaseAuthErrorMessage,
  shouldResetBranchStoreOnAuthChange,
  validateAuthCredentials,
} from "@/lib/auth";
import { useBranchStore } from "@/lib/store";

describe("Autenticación y aislamiento por usuario (Paso 4B)", () => {
  it("valida correo, longitud de contraseña y confirmación en registro e inicio de sesión", () => {
    expect(
      validateAuthCredentials({
        email: "correo-invalido",
        password: "Password123",
        mode: "login",
      }),
    ).toMatchObject({ valid: false });

    expect(
      validateAuthCredentials({
        email: "  Usuario@Cafe.com ",
        password: "1234567",
        mode: "register",
      }),
    ).toMatchObject({
      valid: false,
      reason: `La contraseña debe tener al menos ${MIN_SIGNUP_PASSWORD_LENGTH} caracteres.`,
    });

    expect(
      validateAuthCredentials({
        email: "usuario@cafe.com",
        password: "Password123",
        confirmPassword: "Password999",
        mode: "register",
      }),
    ).toMatchObject({
      valid: false,
      reason: "Las contraseñas no coinciden.",
    });

    expect(
      validateAuthCredentials({
        email: "usuario@cafe.com",
        password: "Password123",
        confirmPassword: "Password123",
        acceptedPrivacyPolicy: false,
        mode: "register",
      }),
    ).toMatchObject({
      valid: false,
      reason:
        "Debes autorizar el tratamiento de datos personales (Ley 1581) para crear tu cuenta.",
    });

    expect(
      validateAuthCredentials({
        email: "  Usuario@Cafe.com ",
        password: "Password123",
        confirmPassword: "Password123",
        fullName: "  Café Don Juan ",
        acceptedPrivacyPolicy: true,
        mode: "register",
      }),
    ).toEqual({
      valid: true,
      normalizedEmail: "usuario@cafe.com",
      normalizedName: "Café Don Juan",
    });
  });

  it("deriva un nombre legible para el perfil cuando no se indica nombre de negocio", () => {
    expect(deriveProfileDisplayName("emanuel@cafe.com", "  Café Norte  ")).toBe(
      "Café Norte",
    );
    expect(deriveProfileDisplayName("emanuel@cafe.com", "")).toBe("Emanuel");
    expect(deriveProfileDisplayName(null, null)).toBe("Mi Negocio");
  });

  it("limpia el store de sucursales al cerrar sesión o cambiar de usuario", () => {
    expect(shouldResetBranchStoreOnAuthChange(null, "user-a")).toBe(false);
    expect(shouldResetBranchStoreOnAuthChange("user-a", "user-a")).toBe(false);
    expect(shouldResetBranchStoreOnAuthChange("user-a", "user-b")).toBe(true);
    expect(shouldResetBranchStoreOnAuthChange("user-a", null)).toBe(true);

    useBranchStore.getState().setSucursales([
      {
        id: "suc-1",
        perfil_id: "perf-1",
        nombre: "Sede A",
        tono: "Cercano",
        reglas_negativas: "Ninguna",
      },
    ]);
    expect(useBranchStore.getState().sucursales).toHaveLength(1);
    useBranchStore.getState().resetBranches();
    expect(useBranchStore.getState().sucursales).toEqual([]);
    expect(useBranchStore.getState().sucursalActiva).toBeNull();
  });

  it("traduce errores comunes de Supabase Auth a mensajes seguros en español", () => {
    expect(mapSupabaseAuthErrorMessage({ message: "Invalid login credentials" })).toBe(
      "Correo o contraseña incorrectos.",
    );
    expect(mapSupabaseAuthErrorMessage({ message: "Email not confirmed" })).toContain(
      "confirmar tu correo",
    );
    expect(mapSupabaseAuthErrorMessage({ message: "User already registered" })).toContain(
      "ya está registrado",
    );
  });

  it("detecta columna user_id ausente y degrada sin romper antes de migrar Supabase", () => {
    expect(
      isMissingUserIdColumnError({
        code: "42703",
        message: "column perfiles.user_id does not exist",
      }),
    ).toBe(true);
    expect(
      isMissingUserIdColumnError({
        message: "Could not find the 'user_id' column of 'perfiles' in the schema cache",
      }),
    ).toBe(true);
    expect(isMissingUserIdColumnError({ code: "42501", message: "permission denied" })).toBe(
      false,
    );
  });

  it("reutiliza el perfil existente del usuario o crea uno nuevo asociado a user_id", async () => {
    const existingLimit = vi.fn().mockResolvedValue({
      data: [{ id: "perfil-existente" }],
      error: null,
    });
    const existingClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ limit: existingLimit }),
        }),
      }),
    } as unknown as Pick<SupabaseClient, "from">;

    await expect(
      ensureUserPerfil(existingClient, {
        id: "user-1",
        email: "a@cafe.com",
        user_metadata: {},
      }),
    ).resolves.toBe("perfil-existente");

    const insertSingle = vi.fn().mockResolvedValue({
      data: { id: "perfil-nuevo" },
      error: null,
    });
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
    const insertFn = vi.fn().mockReturnValue({ select: insertSelect });
    const emptyLimit = vi.fn().mockResolvedValue({ data: [], error: null });
    const newClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ limit: emptyLimit }),
        }),
        insert: insertFn,
      }),
    } as unknown as Pick<SupabaseClient, "from">;

    await expect(
      ensureUserPerfil(newClient, {
        id: "user-2",
        email: "b@cafe.com",
        user_metadata: { full_name: "Sucursal B" },
      }),
    ).resolves.toBe("perfil-nuevo");
    expect(insertFn).toHaveBeenCalledWith([{ nombre: "Sucursal B", user_id: "user-2" }]);
  });
});
