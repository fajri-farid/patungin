import type { BillDocument, ReconciliationIssue } from "@/domain/billing/types";

/** Give the next user action instead of describing calculation internals. */
export function billingIssueMessage(
  issue: ReconciliationIssue,
  bill: BillDocument,
): string {
  const item = bill.items.find((entry) => entry.id === issue.itemId);
  const adjustment = bill.adjustments.find(
    (entry) => entry.id === issue.adjustmentId,
  );
  const name = item?.name || "pesanan ini";
  const fee = adjustment?.name || "biaya atau diskon ini";
  const messages: Record<string, string> = {
    NO_ITEMS: "Tambahkan setidaknya satu pesanan.",
    NO_PARTICIPANTS: "Tambahkan nama orang yang ikut makan.",
    EMPTY_PARTICIPANT_NAME: "Isi nama teman yang masih kosong.",
    INVALID_PAYER: "Pilih siapa yang membayar tagihan lebih dulu.",
    ITEM_NAME_EMPTY: "Isi nama pesanan yang masih kosong.",
    ITEM_QUANTITY_INVALID: `Isi jumlah “${name}” dengan angka 1 atau lebih.`,
    ITEM_AMOUNT_INVALID: `Lengkapi total harga “${name}”.`,
    ITEM_UNIT_PRICE_INVALID: `Periksa harga satuan “${name}”.`,
    ITEM_UNALLOCATED: `Pilih siapa yang pesan “${name}”.`,
    ITEM_UNITS_MISMATCH: `Jumlah “${name}” yang dibagi belum sesuai struk. Periksa pembagiannya.`,
    ITEM_SHARED_EMPTY_OR_INVALID: `Pilih siapa saja yang ikut makan “${name}”.`,
    ITEM_MODE_INVALID: `Atur kembali cara membagi “${name}”.`,
    ADJUSTMENT_SCOPE_UNCONFIRMED: `Periksa pesanan mana yang mendapat “${fee}”.`,
    ADJUSTMENT_EMPTY_SCOPE: `Pilih setidaknya satu pesanan untuk “${fee}”.`,
    ADJUSTMENT_AMOUNT_INVALID: `Lengkapi jumlah “${fee}” sesuai struk.`,
    ADJUSTMENT_RATE_MISSING: `Isi persentase “${fee}” sesuai struk.`,
    DEPENDENCY_CYCLE_OR_INVALID: `Periksa pengaturan “${fee}”. Pilih kembali biaya yang ikut dihitung.`,
    ROUNDING_NAME_EMPTY: "Beri nama untuk pembulatan agar rinciannya jelas.",
    GRAND_TOTAL_UNCONFIRMED: "Isi total akhir di struk.",
    REVIEW_HASH_STALE:
      "Pesanan atau harga berubah. Cek struk sekali lagi sebelum lanjut.",
  };
  return messages[issue.code] ?? issue.message;
}

export function formatReceiptDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Makassar",
  }).format(date);
}
