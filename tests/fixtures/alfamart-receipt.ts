// Transcribed product/price evidence only; delivery and customer details are excluded.
export const alfamartProducts = [
  { name: "Sedaap Mi Instan Selection Singapore Laksa Pedas 83 g", quantity: 9, unitPrice: 3000, lineAmount: 27000, discount: 3000 },
  { name: "Champ Sosis Ayam 500 g", quantity: 2, unitPrice: 39100, lineAmount: 78200, discount: 24400 },
  { name: "Indomie Mi Instan Coto Makassar 75 g", quantity: 5, unitPrice: 3300, lineAmount: 16500, discount: 2000 },
  { name: "Indomie Mi Instan Rasa Rawon Pedas Mercon 75 g", quantity: 5, unitPrice: 4000, lineAmount: 20000, discount: 5500 },
  { name: "So Good Naget Ayam Dino Bites Original 400 g", quantity: 1, unitPrice: 58700, lineAmount: 58700, discount: 19000 },
  { name: "SunCo Minyak Goreng Pouch 2 L", quantity: 1, unitPrice: 48400, lineAmount: 48400, discount: 3900 },
  { name: "Fiesta Ready to Go Sosis Ayam Hickory Barbeque Lava 60 g", quantity: 1, unitPrice: 10400, lineAmount: 10400, discount: 5400 },
  { name: "Fiesta Ready to Go Sosis Ayam Hot Lava 60 g", quantity: 1, unitPrice: 10900, lineAmount: 10900, discount: 5900 },
  { name: "Bango Kecap Manis Refill 380 g", quantity: 1, unitPrice: 15700, lineAmount: 15700, discount: 5700 },
];

export function alfamartReceipt() {
  return {
    sourceType: "transaction_screenshot", currency: "IDR", merchant: "Alfamart", receiptDate: null,
    printedSubtotal: 285800, printedDiscountTotal: 74800, printedGrandTotal: 211000, displayedQuantity: 26, warnings: [],
    items: alfamartProducts.map(product => ({ name: product.name, quantity: product.quantity, unitPrice: product.unitPrice, lineAmount: product.lineAmount,
      quantityStatus: "observed", rowRole: "item", parentItemIndex: null, priceRelation: "separate",
      unitPriceRole: "effective", lineAmountBasis: "gross", needsReview: false })),
    adjustments: alfamartProducts.map((product, index) => ({ name: `Disc. -${product.discount.toLocaleString("en-US")}`,
      kind: "item-discount", amount: product.discount, mode: "added", rateBps: null, basis: "gross", sign: null,
      amountAlreadyIncluded: false, appliesToItemIndexes: [index + 1], dependsOnAdjustmentIndexes: [],
      summaryOfAdjustmentIndexes: [] as number[], scopeEvidence: "layout", needsReview: false })),
  };
}
