import { describe, expect, it } from "vitest";
import { einvoiceReadiness } from "@/server/modules/billing/einvoice-pure";

const full = { nameAr: "شركة اختبار", crNumber: "1010000000", nationalAddress: "الرياض", vatRegistration: "registered", vatNumber: "300000000000003" };
const creds = { csid: true, secret: true, env: "simulation" };

describe("e-invoicing switches on by itself only when every condition holds", () => {
  it("stays off while the tax data, the credentials or the connector are missing", () => {
    expect(einvoiceReadiness({ company: {}, credentials: creds, connector: true }).active).toBe(false);
    expect(einvoiceReadiness({ company: full, credentials: { ...creds, csid: false }, connector: true }).active).toBe(false);
    expect(einvoiceReadiness({ company: full, credentials: creds, connector: false }).active).toBe(false);
    const r = einvoiceReadiness({ company: { ...full, vatNumber: "123" }, credentials: creds, connector: true });
    expect(r.items.find((i) => !i.ok)?.detail).toContain("الرقم الضريبي");
  });
  it("is active once everything is complete", () => {
    expect(einvoiceReadiness({ company: full, credentials: creds, connector: true }).active).toBe(true);
  });
  it("the connector is not built yet, so it is off today whatever the data", () => {
    expect(einvoiceReadiness({ company: full, credentials: creds }).active).toBe(false);
  });
});
