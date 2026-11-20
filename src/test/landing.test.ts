import { describe, expect, it } from "vitest";
import {
  DEFAULT_WHATSAPP_PHONE,
  LANDING_BENEFITS,
  LANDING_PAIN_POINTS,
  LANDING_PLANS,
  buildWhatsAppLeadUrl,
  resolveWhatsAppPhone,
} from "@/lib/landing";

describe("Landing page · reglas y configuración de conversión (src/lib/landing.ts)", () => {
  it("normaliza teléfonos de WhatsApp colombianos y cae seguro al número por defecto", () => {
    expect(resolveWhatsAppPhone("+57 312 456 7890")).toBe("573124567890");
    expect(resolveWhatsAppPhone("310-555-1234")).toBe("573105551234");
    expect(resolveWhatsAppPhone("   ")).toBe(DEFAULT_WHATSAPP_PHONE);
    expect(resolveWhatsAppPhone("123")).toBe(DEFAULT_WHATSAPP_PHONE);
  });

  it("construye enlaces wa.me válidos con mensaje general o por plan específico", () => {
    const defaultUrl = buildWhatsAppLeadUrl({ phone: "573112223344" });
    expect(defaultUrl.startsWith("https://wa.me/573112223344?text=")).toBe(true);
    expect(decodeURIComponent(defaultUrl.split("?text=")[1] ?? "")).toContain(
      "AutoSocial AI",
    );

    const planUrl = buildWhatsAppLeadUrl({
      phone: "3112223344",
      planName: "Plan Emprendedor",
    });
    expect(planUrl.startsWith("https://wa.me/573112223344?text=")).toBe(true);
    expect(decodeURIComponent(planUrl.split("?text=")[1] ?? "")).toContain(
      "Plan Emprendedor",
    );
  });

  it("define los 3 dolores, 3 beneficios (Tiempo, Plata, Tranquilidad) y planes claros en COP", () => {
    expect(LANDING_PAIN_POINTS).toHaveLength(3);
    expect(LANDING_BENEFITS.map((b) => b.id)).toEqual([
      "tiempo",
      "plata",
      "tranquilidad",
    ]);

    expect(LANDING_PLANS).toHaveLength(2);
    for (const plan of LANDING_PLANS) {
      expect(plan.priceMonthlyCop).toBeGreaterThan(0);
      expect(plan.priceLabel).toContain("COP");
      expect(plan.features.length).toBeGreaterThanOrEqual(4);
    }
  });
});
