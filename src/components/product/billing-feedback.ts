import type { BillDocument, ReconciliationIssue } from "@/domain/billing/types";
import { MAX_ITEMS_COUNT, MAX_PARTICIPANTS_COUNT } from "@/domain/billing/types";

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
  const participant = bill.participants.find(entry => entry.id === issue.participantId);
  const messages: Record<string, string> = {
    NO_ITEMS: "Tambahkan setidaknya satu pesanan.",
    TOO_MANY_ITEMS: `Maksimal ${MAX_ITEMS_COUNT} pesanan per tagihan.`,
    NO_PARTICIPANTS: "Tambahkan nama orang yang ikut makan.",
    TOO_MANY_PARTICIPANTS: `Maksimal ${MAX_PARTICIPANTS_COUNT} orang per tagihan.`,
    DUPLICATE_PARTICIPANT_ID: "Ada data teman yang terulang. Muat ulang halaman lalu coba lagi.",
    DUPLICATE_ITEM_ID: "Ada data pesanan yang terulang. Muat ulang halaman lalu coba lagi.",
    DUPLICATE_ADJUSTMENT_ID: "Ada biaya atau diskon yang terulang. Muat ulang halaman lalu coba lagi.",
    EMPTY_PARTICIPANT_NAME: "Isi nama teman yang masih kosong.",
    INVALID_PAYER: "Pilih siapa yang membayar tagihan lebih dulu.",
    ITEM_NAME_EMPTY: "Isi nama pesanan yang masih kosong.",
    ITEM_UNCONFIRMED: `Cocokkan nama, jumlah, dan harga “${name}” dengan struk.`,
    ITEM_QUANTITY_INVALID: `Isi jumlah “${name}” dengan angka 1 atau lebih.`,
    ITEM_AMOUNT_INVALID: `Lengkapi total harga “${name}”.`,
    ITEM_UNIT_PRICE_INVALID: `Periksa harga satuan “${name}”.`,
    ITEM_UNIT_MISMATCH: `Cocokkan harga “${name}” dengan struk, lalu pilih Pakai total atau Pakai harga asli.`,
    ITEM_QUANTITY_UNCONFIRMED: `Pastikan jumlah “${name}” sesuai struk.`,
    ROUNDING_DIRECTION_UNCONFIRMED: "Pilih apakah pembulatan menambah atau mengurangi total.",
    ADJUSTMENT_BASIS_UNCONFIRMED: `Pastikan dasar perhitungan “${fee}” sesuai struk.`,
    DISCOUNT_TREATMENT_UNCONFIRMED: `Pastikan apakah “${fee}” masih dipotong atau sudah masuk harga pesanan.`,
    ITEM_UNALLOCATED: `Pilih siapa yang pesan “${name}”.`,
    ITEM_UNITS_MISMATCH: `Jumlah “${name}” yang dibagi belum sesuai struk. Periksa pembagiannya.`,
    ITEM_SHARED_EMPTY_OR_INVALID: `Pilih siapa saja yang ikut makan “${name}”.`,
    ITEM_MODE_INVALID: `Atur kembali cara membagi “${name}”.`,
    ADJUSTMENT_SCOPE_UNCONFIRMED: `Periksa pesanan mana yang mendapat “${fee}”.`,
    ADJUSTMENT_EMPTY_SCOPE: `Pilih setidaknya satu pesanan untuk “${fee}”.`,
    ADJUSTMENT_AMOUNT_INVALID: `Lengkapi jumlah “${fee}” sesuai struk.`,
    ADJUSTMENT_UNCONFIRMED: `Cek “${fee}” di halaman Cek struk sebelum lanjut.`,
    ADJUSTMENT_RATE_INVALID: `Periksa persentase “${fee}” sesuai struk.`,
    ADJUSTMENT_RATE_MISMATCH: `Jumlah “${fee}” berbeda dari hitungan persentasenya. Jumlah yang tertulis di struk dipakai sebagai acuan.`,
    ADJUSTMENT_RATE_MISSING: `Isi persentase “${fee}” sesuai struk.`,
    DEPENDENCY_CYCLE_OR_INVALID: `Periksa pengaturan “${fee}”. Pilih kembali biaya yang ikut dihitung.`,
    ROUNDING_NAME_EMPTY: "Beri nama untuk pembulatan agar rinciannya jelas.",
    GRAND_TOTAL_UNCONFIRMED: "Isi total akhir di struk.",
    GRAND_TOTAL_MISMATCH: "Total pesanan dan biaya belum cocok dengan struk. Cek harga, pajak, dan diskonnya.",
    DISCOUNT_EXCEEDS_BASE: `“${fee}” lebih besar dari harga pesanan yang mendapat diskon. Cek jumlah dan pilihan pesanannya.`,
    DISCOUNT_ITEM_OVERFLOW: `Diskon untuk “${name}” melebihi harganya. Cek jumlah dan pilihan pesanannya.`,
    ZERO_BASE_FOR_POSITIVE_CHARGE: `Harga pesanan yang dipilih untuk “${fee}” masih Rp0. Periksa harga dan pilihan pesanannya.`,
    ROUNDING_ZERO_BASE: `“${fee}” belum bisa dibagi karena total pesanan masih Rp0. Cek harga pesanan dulu.`,
    ROUNDING_NEGATIVE_OVERFLOW: `Pengurangan “${fee}” melebihi total tagihan. Cek kembali jumlahnya.`,
    NEGATIVE_PARTICIPANT_TOTAL: `Bagian ${participant?.name || "salah satu teman"} kurang dari Rp0. Cek diskon dan pembagiannya.`,
    CONSERVATION_MISMATCH: "Jumlah bagian semua teman belum cocok dengan total tagihan. Cek apakah semua pesanan sudah dibagi.",
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
