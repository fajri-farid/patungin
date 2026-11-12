import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReceiptItemNotice } from "../src/components/ReceiptItemNotice";
import type { BillItem } from "../src/domain/billing/types";

const item: BillItem = { id: "milk-tea", allocationOrder: 0, name: "Milk Tea (R)", quantity: 1,
  unitPrice: 12000, lineAmount: 17000, reviewConfirmed: false, quantityStatus: "observed" };

function render(extra: Partial<BillItem> = {}, locked = false) {
  const current = { ...item, ...extra };
  return renderToStaticMarkup(createElement(ReceiptItemNotice, { item: current, items: [current], locked,
    onChange: () => {}, onMerge: () => {} }));
}

describe("receipt price choices", () => {
  it("offers both prices and a receipt reference when the unit price disagrees with the total", () => {
    const html = render();
    expect(html).toContain("Pakai total Rp17.000");
    expect(html).toContain("Pakai harga asli Rp12.000");
    expect(html).toContain("Lihat struk");
  });

  it("makes the original unit price calculation explicit for multiple units", () => {
    expect(render({ quantity: 2, lineAmount: 34000 })).toContain("Pakai harga asli Rp12.000 × 2 = Rp24.000");
  });

  it("withholds the original price choice until the quantity is known", () => {
    const html = render({ quantityStatus: "unreadable" });
    expect(html).toContain("Jumlah benar: 1");
    expect(html).not.toContain("Pakai harga asli");
    expect(html).not.toContain("Pakai total");
  });

  it("does not show a false mismatch for a total that explicitly includes a topping", () => {
    expect(render({ unitPrice: null, baseUnitPrice: 12000, includedModifiers: ["Toping Boba Minum"] })).toBe("");
  });

  it("does not offer price changes on a locked bill", () => {
    expect(render({}, true)).not.toContain("<button");
  });
});
