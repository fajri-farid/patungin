/**
 * Tipe Domain Inti Patungin (Mesin Hitung & Model Tagihan)
 *
 * Seluruh nominal uang disimpan sebagai integer Rupiah (IDR) tanpa desimal.
 * Persentase disimpan sebagai Basis Points (bps): 10% = 1000 bps, 2.5% = 250 bps.
 */

export const CALCULATION_VERSION = 1;
export const BILL_SCHEMA_VERSION = 1;
export const MAX_IDR_AMOUNT = 1_000_000_000_000; // Rp1 Triliun (batas kebijakan awal)
export const MAX_ITEMS_COUNT = 100;
export const MAX_PARTICIPANTS_COUNT = 30;
export const SHARE_LINK_EXPIRY_DAYS = 7;

export type CurrencyCode = "IDR";

export type ValueSource = "ocr-unconfirmed" | "host-confirmed" | "derived";

export interface Participant {
  id: string;
  allocationOrder: number;
  name: string;
  label?: string; // Pembeda opsional bila ada teman bernama sama
}

export interface BillItem {
  id: string;
  allocationOrder: number;
  name: string;
  quantity: number; // Integer bulat positif >= 1
  unitPrice?: number | null; // Opsional, integer >= 0
  lineAmount: number | null; // Nominal baris sebelum diskon/pajak terpisah (kecuali inclusive)
  lineAmountSource?: "observed" | "derived";
  reviewConfirmed: boolean;
  unitMismatchConfirmed?: boolean; // True jika host sadar lineAmount != quantity * unitPrice (mis. pembulatan merchant)
  ambiguityReason?: string | null; // Alasan dari OCR jika buram/ambigu
  quantityStatus?: "observed" | "not_printed" | "unreadable" | "confirmed";
  receiptIssues?: Array<"CHECK_ITEM" | "MODIFIER_RELATION_UNKNOWN" | "PRICE_DERIVED">;
  includedModifiers?: string[];
  /** Printed base price, retained when the payable total includes modifiers. */
  baseUnitPrice?: number | null;
  suggestedParentItemId?: string | null;
}

export type AllocationMode = "units" | "shared";

export interface ItemAllocation {
  itemId: string;
  mode: AllocationMode;
  /** Untuk mode "units": map participantId -> jumlah unit bulat positif */
  unitCounts?: Record<string, number>;
  /** Untuk mode "shared": daftar participantId yang ikut berbagi rata */
  participantIds?: string[];
}

export type AdjustmentKind =
  | "item-discount"
  | "bill-discount"
  | "service"
  | "tax"
  | "fee"
  | "rounding";

export type AdjustmentMode = "added" | "included";

export type AdjustmentBasis = "gross" | "net";

export type AdjustmentAmountSource = "observed" | "derived";

export interface BillAdjustment {
  id: string;
  allocationOrder: number;
  name: string;
  kind: AdjustmentKind;
  /**
   * Nominal absolut komponen (>= 0).
   * Tanda +/- ditentukan oleh kind (discount mengurangi, service/tax/fee menambah).
   * Khusus kind === "rounding", tanda ditentukan oleh sign ("positive" | "negative").
   */
  amount: number | null;
  /** Khusus untuk kind === "rounding" / penyesuaian akhir: apakah menambah atau mengurangi tagihan */
  sign?: "positive" | "negative";
  amountSource: AdjustmentAmountSource;
  mode: AdjustmentMode; // "included" hanya berlaku untuk tax/service yang sudah termasuk harga item
  basis: AdjustmentBasis; // "gross" (sebelum diskon) atau "net" (setelah diskon)
  /** Targets from explicit receipt evidence or host choice. Unknown scopes require review. */
  eligibleItemIds: string[];
  scopeConfirmed: boolean;
  /** Daftar ID adjustment "added" terdahulu yang ikut masuk dasar perhitungan (mis. pajak atas item + service) */
  dependsOnAdjustmentIds?: string[];
  /** Tarif dalam basis points (10% = 1000 bps). Opsional. */
  rateBps?: number | null;
  reviewConfirmed: boolean;
  reason?: string | null; // Wajib diisi jika ada penyesuaian manual
  directionNeedsReview?: boolean;
  basisNeedsReview?: boolean;
  /** Discount gross/net evidence is missing or contradictory; host must choose. */
  discountNeedsReview?: boolean;
}

export interface BillCalculationInput {
  currency: CurrencyCode;
  items: BillItem[];
  participants: Participant[];
  payerParticipantId: string | null;
  allocations: ItemAllocation[];
  adjustments: BillAdjustment[];
  confirmedGrandTotal: number | null;
  /** Hash input finansial saat host menekan konfirmasi review */
  confirmedInputHash?: string | null;
}

export type IssueSeverity = "error" | "warning";

export type IssueStage = "review" | "split" | "reconciliation";

export interface ReconciliationIssue {
  code: string;
  stage: IssueStage;
  severity: IssueSeverity;
  message: string;
  itemId?: string;
  adjustmentId?: string;
  participantId?: string;
}

export interface ParticipantItemShare {
  itemId: string;
  itemName: string;
  mode: AllocationMode;
  units?: number;
  totalUnits: number;
  sharedParticipantCount?: number;
  grossShare: number;
  itemDiscountShare: number;
  billDiscountShare: number;
  netShare: number;
}

export interface ParticipantAdjustmentShare {
  adjustmentId: string;
  name: string;
  kind: AdjustmentKind;
  mode: AdjustmentMode;
  /** Nilai bertanda untuk komponen added/discount/rounding, atau nilai informasional positif untuk included */
  signedAmount: number;
  absoluteAmount: number;
}

export interface ParticipantBreakdown {
  participantId: string;
  participantName: string;
  isPayer: boolean;
  itemsGrossTotal: number;
  discountsTotal: number; // Nilai nonnegatif total pengurangan diskon
  itemsNetTotal: number;
  serviceTotal: number;
  taxAddedTotal: number;
  taxIncludedInfoTotal: number; // Informasional, tidak menambah total bayar
  feeTotal: number;
  roundingSignedTotal: number; // Bisa positif atau negatif
  consumptionTotal: number; // Total bagian makan/minum peserta ini
  transferToPayerAmount: number; // 0 jika peserta ini adalah pembayar
}

export interface CalculationResult {
  calculationVersion: number;
  canFinalize: boolean;
  currentInputHash: string;
  isReviewHashMatching: boolean;
  issues: ReconciliationIssue[];
  computedItemsSubtotal: number;
  computedDiscountsTotal: number;
  computedAddedChargesTotal: number;
  computedRoundingSignedTotal: number;
  computedGrandTotal: number;
  confirmedGrandTotal: number | null;
  grandTotalDifference: number | null; // computedGrandTotal - confirmedGrandTotal
  payerParticipantId: string | null;
  totalReceivableByPayer: number;
  participantBreakdowns: ParticipantBreakdown[];
  /** Matriks alokasi per item -> participantId -> rupiah (gross) */
  itemGrossAllocations: Record<string, Record<string, number>>;
  /** Matriks alokasi per item -> participantId -> rupiah (net setelah semua diskon) */
  itemNetAllocations: Record<string, Record<string, number>>;
  /** Alokasi per adjustment -> participantId -> rupiah absolut */
  adjustmentParticipantAllocations: Record<string, Record<string, number>>;
}

export type BillStatus = "draft" | "finalized";
export type ReceiptSourceType = "printed_receipt" | "cashier_screen" | "transaction_screenshot" | "other_transaction" | "unsupported";

export interface PaymentMethodNote {
  qrisImageId?: string;
  method?: "transfer" | "bank" | "ewallet" | "qris";
  bankOrWalletName?: string;
  accountNumber?: string;
  accountHolderName?: string;
  note?: string;
}

export interface BillDocument {
  receiptPhotoId?: string | null;
  receiptPhotoUploadId?: string | null;
  shareReceiptPhoto?: boolean;
  id: string;
  ownerUid: string;
  ownerVerifiedEmail: string;
  status: BillStatus;
  revision: number;
  schemaVersion: number;
  currency: CurrencyCode;
  title: string;
  merchant: string;
  receiptDate: string | null;
  items: BillItem[];
  participants: Participant[];
  payerParticipantId: string | null;
  allocations: ItemAllocation[];
  adjustments: BillAdjustment[];
  confirmedGrandTotal: number | null;
  confirmedInputHash: string | null;
  paymentNote?: PaymentMethodNote | null;
  paymentMethods?: PaymentMethodNote[];
  finalResult?: FinalizationSnapshot | null;
  currentFinalizationId: string | null;
  activeShareId: string | null;
  scanAttemptCount?: number;
  receiptSourceType?: ReceiptSourceType;
  extractionWarnings?: string[];
  printedSubtotal?: number | null;
  observedGrandTotal?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinalizationSnapshot {
  receiptPhotoId?: string | null;
  shareReceiptPhoto?: boolean;
  id: string;
  billId: string;
  ownerUid: string;
  versionNumber: number;
  sourceRevision: number;
  confirmedInputHash: string;
  calculationVersion: number;
  title: string;
  merchant: string;
  receiptDate: string | null;
  currency: CurrencyCode;
  inputSnapshot: BillCalculationInput;
  calculationResult: CalculationResult;
  paymentNote?: PaymentMethodNote | null;
  paymentMethods?: PaymentMethodNote[];
  finalizedAt: string;
}

export interface ReceiptDetails {
  items: Array<{ id: string; name: string; quantity: number; lineAmount: number }>;
  adjustments: Array<{ id: string; name: string; mode: AdjustmentMode; signedAmount: number }>;
  subtotal: number;
}

export interface PublicShareProjection {
  receiptPhoto?: import("../receipts").ReceiptPhotoInfo;
  shareId: string;
  billId: string;
  finalizationVersion: number;
  calculationVersion: number;
  title: string;
  merchant: string;
  receiptDate: string | null;
  currency: CurrencyCode;
  grandTotal: number;
  payerName: string;
  totalReceivableByPayer: number;
  receiptDetails?: ReceiptDetails;
  participants: Array<{
    id: string;
    name: string;
    label?: string;
    allocationOrder: number;
    isPayer: boolean;
    consumptionTotal: number;
    transferToPayerAmount: number;
    items: ParticipantItemShare[];
    adjustments: ParticipantAdjustmentShare[];
    taxIncludedInfoTotal: number;
  }>;
  paymentNote?: PaymentMethodNote | null;
  paymentMethods?: PaymentMethodNote[];
  finalizedAt: string;
  expiresAt: string;
}
