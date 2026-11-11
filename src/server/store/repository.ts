/**
 * Repository Data & Transaksi Atomik Patungin
 *
 * Mendukung dua mode penyimpanan dengan kontrak identik:
 * 1. Production / Configured: Google Cloud Firestore melalui Firebase Admin SDK.
 * 2. Local Dev Sandbox: Penyimpanan file JSON lokal (.patungin-dev-data.json)
 *    ketika NODE_ENV === "development" dan kredensial Firebase belum diisi.
 *
 * Seluruh operasi memastikan:
 * - Pemeriksaan kepemilikan (ownerUid) di sisi server.
 * - Optimistic concurrency dengan expectedRevision (menghasilkan 409 Conflict jika basi).
 * - Pencabutan share link secara atomik saat tagihan dibuka kembali (reopen) atau dihapus.
 */

import crypto from "node:crypto";
import { productTransaction, firestoreProductTransaction } from "./transaction";
import { billQrisIds, syncQrisReferences } from "../payments/qris-references";
import { addPublicPhotoInfo } from "../receipts/photos";
import type { ApplicationOutcome } from "@/domain/diagnostics";
import { readDevDb, writeDevDb } from "./dev-database";
import { makeSummary, summaryId, type UserMonthSummary } from "../admin/summary";
import { getAccount, hasProductAccess, accountIsActive, isAdmin, retentionDate } from "../access/accounts";
import { FieldPath } from "@google-cloud/firestore";
import { compareBillCursors, decodeBillCursor, encodeBillCursor, type BillCursor } from "./bill-pagination";
import {
  buildDetailedParticipantShares,
  buildReceiptDetails,
  calculateBill,
} from "@/domain/billing/calculation";
import { GOLDEN_FIXTURES } from "@/domain/billing/fixtures";
import { computeFinancialInputHash } from "@/domain/billing/hash";
import { needsQuantityReview } from "@/domain/billing/receipt-review";
import { normalizePaymentNote, normalizePaymentMethods } from "@/domain/billing/payment";
import { isValidIdrInteger, isValidPositiveQuantity } from "@/domain/billing/money";
import {
  BILL_SCHEMA_VERSION,
  CALCULATION_VERSION,
  type BillAdjustment,
  type BillDocument,
  type BillItem,
  type FinalizationSnapshot,
  type ItemAllocation,
  type Participant,
  type PaymentMethodNote,
  type PublicShareProjection,
} from "@/domain/billing/types";
import { getServerConfig } from "../config/env";
import { getAdminFirestore } from "../firebase/admin";
import {
  generateRandomShareId,
  isCurrentShareId,
  signShareToken,
  verifyShareTokenSignature,
} from "../shares/token";

export class AppServiceError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface ShareRecord {
  shareId: string;
  billId: string;
  ownerUid?: string; // legacy
  ownerVerifiedEmail?: string; // legacy
  finalizationId: string;
  publicProjection?: PublicShareProjection; // legacy only
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  signingKeyVersion?: number; // legacy only
  deleteAfter?: Date;
}

export type ScanAttemptState =
  | "reserved"
  | "dispatched"
  | "succeeded"
  | "failed"
  | "unknown";

export interface ScanAttemptRecord {
  id: string;
  ownerUid: string;
  billId: string;
  billRevisionAtStart: number;
  imageHash: string;
  model: string;
  promptVersion: string;
  state: ScanAttemptState;
  reservedAt: string;
  dispatchedAt: string | null;
  usageDateKey?: string; // legacy daily attempts
  usageMonthKey?: string;
  deleteAfter?: Date;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  extractedData?: ExtractedReceiptSuggestion | null;
  applicationOutcome?: ApplicationOutcome | null;
  requestId?: string | null;
}

export interface ExtractedReceiptSuggestion {
  sourceType?: BillDocument["receiptSourceType"];
  printedSubtotal?: number | null;
  printedDiscountTotal?: number | null;
  displayedQuantity?: number | null;
  merchant: string | null;
  receiptDate: string | null;
  items: BillItem[];
  adjustments: BillAdjustment[];
  printedGrandTotal: number | null;
  warnings: string[];
}

export interface UsageBucketRecord {
  dateKey: string;
  deploymentAttempts: number;
  activeLeases: Record<string, number>; // attemptId -> expiresAtMs
  activeLeaseOwners?: Record<string, string>;
  userAttempts: Record<string, number>; // uid -> count
  userBonuses?: Record<string, number>;
  deleteAfter?: Date;
  userMinuteWindows: Record<string, number>; // `${uid}_${minuteBucket}` -> count
}

export function getCurrentDateKeyInTimezone(timezone: string, instant = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(instant); // YYYY-MM-DD
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}

/**
 * Mengambil daftar tagihan milik host, diurutkan dari perubahan terakhir.
 */
export async function listBillsByOwner(ownerUid: string, options: {
  pageSize: number;
  after?: string;
  before?: string;
}): Promise<{ bills: BillDocument[]; previousCursor: string | null; nextCursor: string | null }> {
  if (!Number.isInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > 50 || (options.after && options.before)) {
    throw new AppServiceError(400, "INVALID_PAGE", "Halaman tidak valid.");
  }
  const encodedCursor = options.after ?? options.before;
  const cursor = encodedCursor ? decodeBillCursor(encodedCursor) : null;
  if (encodedCursor && !cursor) throw new AppServiceError(400, "INVALID_PAGE", "Halaman tidak valid.");
  const config = getServerConfig();
  let docs: BillDocument[];
  if (config.isDevSandbox) {
    const db = readDevDb();
    const sorted = Object.values(db.bills)
      .filter((b) => b.ownerUid === ownerUid)
      .sort(compareBillCursors)
      .filter((bill) => !cursor || (options.before ? compareBillCursors(bill, cursor) < 0 : compareBillCursors(bill, cursor) > 0));
    docs = options.before ? sorted.slice(-(options.pageSize + 1)) : sorted.slice(0, options.pageSize + 1);
  } else {
    const firestore = getAdminFirestore();
    let query = firestore.collection("bills")
      .where("ownerUid", "==", ownerUid)
      .orderBy("updatedAt", "desc")
      .orderBy(FieldPath.documentId(), "desc");
    if (cursor) query = options.before
      ? query.endBefore(cursor.updatedAt, cursor.id)
      : query.startAfter(cursor.updatedAt, cursor.id);
    const snapshot = await (options.before
      ? query.limitToLast(options.pageSize + 1)
      : query.limit(options.pageSize + 1)).get();
    docs = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as BillDocument);
  }
  const hasExtra = docs.length > options.pageSize;
  const bills = options.before ? docs.slice(-options.pageSize) : docs.slice(0, options.pageSize);
  const previousCursor = bills.length && (options.before ? hasExtra : !!cursor)
    ? encodeBillCursor(bills[0] as BillCursor) : null;
  const nextCursor = bills.length && (options.before ? !!cursor : hasExtra)
    ? encodeBillCursor(bills[bills.length - 1] as BillCursor) : null;
  return { bills, previousCursor, nextCursor };
}

export async function getLatestDraftByOwner(ownerUid: string): Promise<BillDocument | null> {
  if (getServerConfig().isDevSandbox) {
    return Object.values(readDevDb().bills)
      .filter((bill) => bill.ownerUid === ownerUid && bill.status === "draft")
      .sort(compareBillCursors)[0] ?? null;
  }
  const snapshot = await getAdminFirestore().collection("bills")
    .where("ownerUid", "==", ownerUid)
    .where("status", "==", "draft")
    .orderBy("updatedAt", "desc")
    .limit(1).get();
  return snapshot.empty ? null : { ...snapshot.docs[0].data(), id: snapshot.docs[0].id } as BillDocument;
}

/**
 * Membaca satu tagihan dengan pemeriksaan kepemilikan ketat.
 */
export async function getBillForOwner(
  billId: string,
  ownerUid: string
): Promise<BillDocument> {
  const config = getServerConfig();
  if (config.isDevSandbox) {
    const db = readDevDb();
    const bill = db.bills[billId];
    if (!bill) {
      throw new AppServiceError(404, "BILL_NOT_FOUND", "Tagihan tidak ditemukan.");
    }
    if (bill.ownerUid !== ownerUid) {
      throw new AppServiceError(
        403,
        "FORBIDDEN_BILL_ACCESS",
        "Kamu tidak bisa membuka tagihan ini."
      );
    }
    return structuredClone(bill);
  }

  const firestore = getAdminFirestore();
  const docSnap = await firestore.collection("bills").doc(billId).get();
  if (!docSnap.exists) {
    throw new AppServiceError(404, "BILL_NOT_FOUND", "Tagihan tidak ditemukan.");
  }
  const bill = docSnap.data() as BillDocument;
  if (bill.ownerUid !== ownerUid) {
    throw new AppServiceError(
      403,
      "FORBIDDEN_BILL_ACCESS",
      "Kamu tidak bisa membuka tagihan ini."
    );
  }
  return bill;
}

/**
 * Membuat draft tagihan baru (kosong atau dari preset contoh).
 */
export async function createDraftBill(params: {
  ownerUid: string;
  ownerVerifiedEmail: string;
  ownerDisplayName?: string;
  title?: string;
  merchant?: string;
  presetCode?: string;
}): Promise<BillDocument> {
  const now = new Date().toISOString();
  const billId = `bill_${crypto.randomBytes(8).toString("hex")}`;

  const preset = params.presetCode
    ? GOLDEN_FIXTURES.find((f) => f.code === params.presetCode)
    : undefined;

  const defaultParticipantId = "p-host-1";
  const initialBill: BillDocument = {
    id: billId,
    ownerUid: params.ownerUid,
    ownerVerifiedEmail: params.ownerVerifiedEmail,
    status: "draft",
    revision: 1,
    schemaVersion: BILL_SCHEMA_VERSION,
    currency: "IDR",
    title: params.title?.trim() || preset?.title || "Patungan Baru",
    merchant: params.merchant?.trim() || preset?.merchant || "",
    receiptDate: getCurrentDateKeyInTimezone(getServerConfig().limits.usageTimezone),
    scanAttemptCount: 0,
    items: preset
      ? structuredClone(preset.input.items)
      : [
          {
            id: "item-1",
            allocationOrder: 0,
            name: "",
            quantity: 1,
            unitPrice: null,
            lineAmount: null,
            reviewConfirmed: false,
          },
        ],
    participants: preset
      ? structuredClone(preset.input.participants)
      : [{ id: defaultParticipantId, allocationOrder: 0, name: params.ownerDisplayName?.trim().slice(0, 40) || "Aku" }],
    payerParticipantId: preset
      ? preset.input.payerParticipantId
      : defaultParticipantId,
    allocations: preset
      ? structuredClone(preset.input.allocations)
      : [
          {
            itemId: "item-1",
            mode: "units",
            unitCounts: {},
          },
        ],
    adjustments: preset ? structuredClone(preset.input.adjustments) : [],
    confirmedGrandTotal: preset ? preset.input.confirmedGrandTotal : null,
    confirmedInputHash: preset ? preset.input.confirmedInputHash ?? null : null,
    paymentMethods: [],
    finalResult: null,
    currentFinalizationId: null,
    activeShareId: null,
    createdAt: now,
    updatedAt: now,
  };

  const config = getServerConfig();
  if (config.isDevSandbox) {
    const db = readDevDb();
    db.bills[billId] = initialBill;
    writeDevDb(db);
    return structuredClone(initialBill);
  }

  const firestore = getAdminFirestore();
  await firestore.collection("bills").doc(billId).set(initialBill);
  return initialBill;
}

export interface SaveBillDraftPatch {
  shareReceiptPhoto?: boolean;
  expectedRevision: number;
  title?: string;
  merchant?: string;
  receiptDate?: string | null;
  items?: BillItem[];
  participants?: Participant[];
  payerParticipantId?: string | null;
  allocations?: ItemAllocation[];
  adjustments?: BillAdjustment[];
  confirmedGrandTotal?: number | null;
  markReviewConfirmed?: boolean;
  paymentNote?: PaymentMethodNote | null;
  paymentMethods?: PaymentMethodNote[];
}

/**
 * Menyimpan perubahan draft dengan pemeriksaan expectedRevision (optimistic concurrency).
 */
export async function saveBillDraft(
  billId: string,
  ownerUid: string,
  patch: SaveBillDraftPatch
): Promise<BillDocument> {
  // Batasi ukuran payload awal <= 256 KiB sesuai spesifikasi
  const serializedSize = Buffer.byteLength(JSON.stringify(patch), "utf8");
  if (serializedSize > 256 * 1024) {
    throw new AppServiceError(
      422,
      "PAYLOAD_TOO_LARGE",
      "Isi tagihan terlalu banyak. Kurangi pesanan atau catatan, lalu simpan lagi."
    );
  }

  const applyPatchToBill = (current: BillDocument): BillDocument => {
    if (patch.shareReceiptPhoto !== undefined && typeof patch.shareReceiptPhoto !== "boolean") {
      throw new AppServiceError(422, "INVALID_PHOTO_SHARING", "Pilihan berbagi foto tidak valid.");
    }
    if (current.ownerUid !== ownerUid) {
      throw new AppServiceError(
        403,
        "FORBIDDEN_BILL_ACCESS",
        "Kamu tidak bisa membuka tagihan ini."
      );
    }
    if (current.status === "finalized") {
      throw new AppServiceError(
        409,
        "BILL_ALREADY_FINALIZED",
        "Tagihan sudah selesai. Pilih Ubah tagihan untuk mengeditnya."
      );
    }
    if (current.revision !== patch.expectedRevision) {
      throw new AppServiceError(
        409,
        "STALE_REVISION",
        `Tagihan berubah di tab atau perangkat lain. Muat ulang untuk melihat perubahan terbaru.`
      );
    }

    const updatedItems = patch.items ?? current.items;
    const updatedAdjustments = patch.adjustments ?? current.adjustments;
    const updatedGrandTotal =
      patch.confirmedGrandTotal !== undefined
        ? patch.confirmedGrandTotal
        : current.confirmedGrandTotal;

    const latestFinancialHash = computeFinancialInputHash({
      currency: current.currency,
      confirmedGrandTotal: updatedGrandTotal,
      items: updatedItems,
      adjustments: updatedAdjustments,
    });

    let nextConfirmedHash = current.confirmedInputHash;
    if (patch.markReviewConfirmed) {
      if (updatedAdjustments.some(adjustment => adjustment.discountNeedsReview)) {
        throw new AppServiceError(422, "INCOMPLETE_REVIEW", "Pastikan apakah diskon masih dipotong atau sudah masuk harga pesanan sebelum lanjut.");
      }
      if (!updatedItems.length || updatedItems.some((i) => !isValidIdrInteger(i.lineAmount) || !isValidPositiveQuantity(i.quantity) || needsQuantityReview(i)) || !isValidIdrInteger(updatedGrandTotal)) {
        throw new AppServiceError(422, "INCOMPLETE_REVIEW", "Lengkapi harga, jumlah pesanan, dan total struk sebelum lanjut.");
      }
      nextConfirmedHash = latestFinancialHash;
    } else if (
      current.confirmedInputHash &&
      current.confirmedInputHash !== latestFinancialHash
    ) {
      // Data finansial berubah, batalkan konfirmasi review lama
      nextConfirmedHash = null;
    }

    let paymentNote;
    let paymentMethods;
    try {
      paymentNote = normalizePaymentNote(patch.paymentNote !== undefined ? patch.paymentNote : current.paymentNote);
      paymentMethods = normalizePaymentMethods(
        patch.paymentMethods !== undefined ? patch.paymentMethods : (patch.paymentNote !== undefined ? undefined : current.paymentMethods),
        paymentNote,
      );
      if (patch.paymentMethods !== undefined) paymentNote = null;
    } catch (error) {
      throw new AppServiceError(422, "INVALID_PAYMENT_NOTE", error instanceof Error ? error.message : "Informasi pembayaran tidak valid.");
    }

    const { paymentNote: _legacyPayment, ...currentFields } = current;
    void _legacyPayment;
    return {
      ...currentFields,
      revision: current.revision + 1,
      title: patch.title !== undefined ? patch.title.slice(0, 120) : current.title,
      merchant:
        patch.merchant !== undefined
          ? patch.merchant.slice(0, 120)
          : current.merchant,
      receiptDate:
        patch.receiptDate !== undefined ? patch.receiptDate : current.receiptDate,
      items: updatedItems,
      participants: patch.participants ?? current.participants,
      payerParticipantId:
        patch.payerParticipantId !== undefined
          ? patch.payerParticipantId
          : current.payerParticipantId,
      allocations: patch.allocations ?? current.allocations,
      adjustments: updatedAdjustments,
      confirmedGrandTotal: updatedGrandTotal,
      confirmedInputHash: nextConfirmedHash,
      paymentMethods,
      shareReceiptPhoto: patch.shareReceiptPhoto ?? current.shareReceiptPhoto ?? false,
      updatedAt: new Date().toISOString(),
    };
  };

  return productTransaction(async tx => {
    const current = await tx.get<BillDocument>("bills", billId);
    if (!current) throw new AppServiceError(404, "BILL_NOT_FOUND", "Tagihan tidak ditemukan.");
    const next = applyPatchToBill(current);
    await syncQrisReferences(tx, ownerUid, billQrisIds(current), billQrisIds(next));
    tx.set("bills", billId, next);
    return next;
  });
}

/**
 * Memfinalkan tagihan secara deterministik di server.
 * Menjalankan ulang mesin hitung; menolak bila ada invariant error atau review basi.
 */
export async function finalizeBillOnServer(params: {
  billId: string;
  ownerUid: string;
  expectedRevision: number;
}): Promise<{ bill: BillDocument; snapshot: FinalizationSnapshot }> {
  const config = getServerConfig();

  const executeFinalization = (
    current: BillDocument,
    existingFinalizationsCount: number,
    existingSnapshot?: FinalizationSnapshot
  ): { bill: BillDocument; snapshot: FinalizationSnapshot; isNew: boolean } => {
    if (current.ownerUid !== params.ownerUid) {
      throw new AppServiceError(
        403,
        "FORBIDDEN_BILL_ACCESS",
        "Kamu tidak bisa membuka tagihan ini."
      );
    }

    // Idempotent jika sudah finalized pada revision yang sama
    if (current.receiptPhotoUploadId) throw new AppServiceError(409, "PHOTO_UPLOAD_IN_PROGRESS", "Foto masih disimpan. Tunggu sebelum menyelesaikan tagihan.");
    if (
      current.status === "finalized" &&
      current.revision === params.expectedRevision &&
      existingSnapshot
    ) {
      return { bill: current, snapshot: existingSnapshot, isNew: false };
    }

    if (current.revision !== params.expectedRevision) {
      throw new AppServiceError(
        409,
        "STALE_REVISION",
        "Tagihan sudah berubah. Muat ulang sebelum menyimpan hasil."
      );
    }

    const inputSnapshot = {
      currency: current.currency,
      items: current.items,
      participants: current.participants,
      payerParticipantId: current.payerParticipantId,
      allocations: current.allocations,
      adjustments: current.adjustments,
      confirmedGrandTotal: current.confirmedGrandTotal,
      confirmedInputHash: current.confirmedInputHash,
    };

    const calcResult = calculateBill(inputSnapshot);
    if (!calcResult.canFinalize) {
      const firstError =
        calcResult.issues.find((i) => i.severity === "error")?.message ||
        "Masih ada pesanan atau harga yang perlu dicek.";
      throw new AppServiceError(422, "FINALIZATION_VALIDATION_FAILED", firstError);
    }

    const now = new Date().toISOString();
    const finalizationId = `fin_${crypto.randomBytes(8).toString("hex")}`;
    const versionNumber = existingFinalizationsCount + 1;

    const snapshot: FinalizationSnapshot = {
      id: finalizationId,
      billId: current.id,
      ownerUid: current.ownerUid,
      versionNumber,
      sourceRevision: current.revision,
      confirmedInputHash: calcResult.currentInputHash,
      calculationVersion: CALCULATION_VERSION,
      title: current.title,
      merchant: current.merchant,
      receiptDate: current.receiptDate,
      currency: current.currency,
      inputSnapshot,
      calculationResult: calcResult,
      paymentMethods: normalizePaymentMethods(current.paymentMethods, current.paymentNote),
      receiptPhotoId: current.receiptPhotoId ?? null,
      shareReceiptPhoto: current.shareReceiptPhoto === true,
      finalizedAt: now,
    };

    const updatedBill: BillDocument = {
      ...current,
      status: "finalized",
      revision: current.revision + 1,
      currentFinalizationId: finalizationId,
      finalResult: snapshot,
      updatedAt: now,
    };

    return { bill: updatedBill, snapshot, isNew: true };
  };

  if (config.isDevSandbox) {
    const db = readDevDb();
    return productTransaction(async tx => {
      const current = await tx.get<BillDocument>("bills", params.billId);
      if (!current) {
        throw new AppServiceError(404, "BILL_NOT_FOUND", "Tagihan tidak ditemukan.");
      }
      const existingList = Object.values(db.finalizations).filter(
        (f) => f.billId === params.billId
      );
      const activeSnap = current.currentFinalizationId
        ? current.finalResult ?? db.finalizations[current.currentFinalizationId]
        : undefined;

      const res = executeFinalization(current, current.finalResult?.versionNumber ?? existingList.length, activeSnap);
      if (res.isNew) {
        await syncQrisReferences(tx, params.ownerUid, billQrisIds(current), billQrisIds(res.bill));
        tx.set("bills", params.billId, res.bill);
      }
      return {
        bill: structuredClone(res.bill),
        snapshot: structuredClone(res.snapshot),
      };
    });
  }

  const firestore = getAdminFirestore();
  const billRef = firestore.collection("bills").doc(params.billId);
  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(billRef);
    if (!snap.exists) throw new AppServiceError(404, "BILL_NOT_FOUND", "Tagihan tidak ditemukan.");
    const current = snap.data() as BillDocument;
    let active = current.finalResult ?? undefined;
    if (!active && current.currentFinalizationId) {
      const legacy = await tx.get(billRef.collection("finalizations").doc(current.currentFinalizationId));
      if (legacy.exists) active = legacy.data() as FinalizationSnapshot;
    }
    const res = executeFinalization(current, active?.versionNumber ?? 0, active);
    if (res.isNew) {
      await syncQrisReferences(firestoreProductTransaction(tx), params.ownerUid, billQrisIds(current), billQrisIds(res.bill));
      tx.set(billRef, res.bill);
    }
    return { bill: res.bill, snapshot: res.snapshot };
  });
}

/**
 * Mengambil snapshot finalisasi aktif untuk sebuah tagihan.
 */
export async function getActiveFinalizationForBill(
  billId: string,
  ownerUid: string
): Promise<FinalizationSnapshot | null> {
  const bill = await getBillForOwner(billId, ownerUid);
  if (bill.status !== "finalized") return null;
  if (bill.finalResult) return structuredClone(bill.finalResult);
  if (!bill.currentFinalizationId) return null;

  const config = getServerConfig();
  if (config.isDevSandbox) {
    const db = readDevDb();
    const snap = db.finalizations[bill.currentFinalizationId];
    return snap ? structuredClone(snap) : null;
  }

  const firestore = getAdminFirestore();
  const snapDoc = await firestore
    .collection("bills")
    .doc(billId)
    .collection("finalizations")
    .doc(bill.currentFinalizationId)
    .get();

  return snapDoc.exists ? (snapDoc.data() as FinalizationSnapshot) : null;
}

/**
 * Membuka kembali (reopen) tagihan yang sudah final menjadi draft,
 * dan mencabut share link aktif secara atomik dalam transaksi yang sama!
 */
export async function reopenBillToDraft(params: {
  billId: string;
  ownerUid: string;
  expectedRevision: number;
}): Promise<BillDocument> {
  const config = getServerConfig();
  const now = new Date().toISOString();

  if (config.isDevSandbox) {
    const db = readDevDb();
    const current = db.bills[params.billId];
    if (!current) {
      throw new AppServiceError(404, "BILL_NOT_FOUND", "Tagihan tidak ditemukan.");
    }
    if (current.ownerUid !== params.ownerUid) {
      throw new AppServiceError(403, "FORBIDDEN", "Akses ditolak.");
    }
    if (current.revision !== params.expectedRevision) {
      throw new AppServiceError(
        409,
        "STALE_REVISION",
        "Tagihan berubah di tab atau perangkat lain. Muat ulang halaman."
      );
    }

    if (current.activeShareId && db.shares[current.activeShareId]) {
      db.shares[current.activeShareId].revokedAt = now;
    }

    const updated: BillDocument = {
      ...current,
      status: "draft",
      revision: current.revision + 1,
      activeShareId: null,
      updatedAt: now,
    };
    db.bills[params.billId] = updated;
    writeDevDb(db);
    return structuredClone(updated);
  }

  const firestore = getAdminFirestore();
  const billRef = firestore.collection("bills").doc(params.billId);

  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(billRef);
    if (!snap.exists) {
      throw new AppServiceError(404, "BILL_NOT_FOUND", "Tagihan tidak ditemukan.");
    }
    const current = snap.data() as BillDocument;
    if (current.ownerUid !== params.ownerUid) {
      throw new AppServiceError(403, "FORBIDDEN", "Akses ditolak.");
    }
    if (current.revision !== params.expectedRevision) {
      throw new AppServiceError(
        409,
        "STALE_REVISION",
        "Tagihan berubah di tab atau perangkat lain. Muat ulang halaman."
      );
    }

    if (current.activeShareId) {
      const shareRef = firestore.collection("shares").doc(current.activeShareId);
      tx.update(shareRef, { revokedAt: now });
    }

    const updated: BillDocument = {
      ...current,
      status: "draft",
      revision: current.revision + 1,
      activeShareId: null,
      updatedAt: now,
    };
    tx.set(billRef, updated);
    return updated;
  });
}

/**
 * Membuat atau mengambil link publik baca-saja (/s/[token]) untuk snapshot final terbaru.
 */
function getShareExpiry(share: Pick<ShareRecord, "createdAt" | "expiresAt">, days: number): number {
  return Math.min(new Date(share.expiresAt).getTime(), new Date(share.createdAt).getTime() + days * 24 * 60 * 60 * 1000);
}

function assertShareRevision(bill: BillDocument, expectedRevision: number): void {
  if (bill.revision !== expectedRevision) {
    throw new AppServiceError(409, "STALE_REVISION", "Data tagihan telah diperbarui. Muat ulang halaman lalu coba lagi.");
  }
}

export async function publishBillShareLink(params: {
  billId: string;
  ownerUid: string;
  expectedRevision: number;
}): Promise<{ shareToken: string; shareRecord: ShareRecord; bill: BillDocument }> {
  const config = getServerConfig();
  if (!config.share.linksEnabled || !config.share.isConfigured) {
    throw new AppServiceError(
      403,
      "SHARE_LINKS_DISABLED",
      "Berbagi lewat link belum tersedia. Kamu tetap bisa menyalin ringkasan."
    );
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAtIso = new Date(
    now.getTime() + config.share.expiryDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const buildShareData = (
    bill: BillDocument,
    snapshot: FinalizationSnapshot,
    shareId: string
  ): ShareRecord => {
    return {
      shareId,
      billId: bill.id,
      finalizationId: snapshot.id,
      createdAt: nowIso,
      expiresAt: expiresAtIso,
      revokedAt: null,
      deleteAfter: new Date(expiresAtIso),
    };
  };

  if (config.isDevSandbox) {
    const db = readDevDb();
    const bill = db.bills[params.billId];
    if (!bill) {
      throw new AppServiceError(404, "BILL_NOT_FOUND", "Tagihan tidak ditemukan.");
    }
    if (bill.ownerUid !== params.ownerUid) {
      throw new AppServiceError(403, "FORBIDDEN", "Akses ditolak.");
    }
    if (bill.status !== "finalized" || !bill.currentFinalizationId) {
      throw new AppServiceError(
        422,
        "BILL_NOT_FINALIZED",
        "Simpan hasil pembagian sebelum membuat link."
      );
    }

    // Jika sudah ada share aktif untuk finalisasi terbaru, kembalikan yang ada (idempotent)
    const existing = bill.activeShareId ? db.shares[bill.activeShareId] : undefined;
    if (existing) {
      if (
        isCurrentShareId(existing.shareId) &&
        !existing.revokedAt &&
        existing.finalizationId === bill.currentFinalizationId &&
        now.getTime() < getShareExpiry(existing, config.share.expiryDays)
      ) {
        return {
          shareToken: signShareToken(existing.shareId),
          shareRecord: structuredClone(existing),
          bill: structuredClone(bill),
        };
      }
    }

    assertShareRevision(bill, params.expectedRevision);

    const snapshot = bill.finalResult ?? db.finalizations[bill.currentFinalizationId];
    if (!snapshot) {
      throw new AppServiceError(
        404,
        "SNAPSHOT_NOT_FOUND",
        "Hasil pembagian belum tersedia. Buka tagihan dan simpan hasilnya."
      );
    }

    if (existing) existing.revokedAt = nowIso;

    const shareId = generateRandomShareId();
    const shareRecord = buildShareData(bill, snapshot, shareId);
    const updatedBill: BillDocument = {
      ...bill,
      activeShareId: shareId,
      revision: bill.revision + 1,
      updatedAt: nowIso,
    };

    db.shares[shareId] = shareRecord;
    db.bills[bill.id] = updatedBill;
    writeDevDb(db);

    return {
      shareToken: signShareToken(shareId),
      shareRecord: structuredClone(shareRecord),
      bill: structuredClone(updatedBill),
    };
  }

  const firestore = getAdminFirestore();
  const billRef = firestore.collection("bills").doc(params.billId);

  return firestore.runTransaction(async (tx) => {
    const billSnap = await tx.get(billRef);
    if (!billSnap.exists) {
      throw new AppServiceError(404, "BILL_NOT_FOUND", "Tagihan tidak ditemukan.");
    }
    const bill = billSnap.data() as BillDocument;
    if (bill.ownerUid !== params.ownerUid) {
      throw new AppServiceError(403, "FORBIDDEN", "Akses ditolak.");
    }
    if (bill.status !== "finalized" || !bill.currentFinalizationId) {
      throw new AppServiceError(
        422,
        "BILL_NOT_FINALIZED",
        "Simpan hasil pembagian sebelum membuat link."
      );
    }

    let snapshot = bill.finalResult;
    if (!snapshot) {
      const finSnap = await tx.get(billRef.collection("finalizations").doc(bill.currentFinalizationId));
      if (!finSnap.exists) throw new AppServiceError(404, "SNAPSHOT_NOT_FOUND", "Hasil pembagian belum tersedia. Buka tagihan dan simpan hasilnya.");
      snapshot = finSnap.data() as FinalizationSnapshot;
    }

    if (bill.activeShareId) {
      const oldShareRef = firestore.collection("shares").doc(bill.activeShareId);
      const oldShareSnap = await tx.get(oldShareRef);
      const existing = oldShareSnap.exists ? oldShareSnap.data() as ShareRecord : null;
      if (existing && isCurrentShareId(existing.shareId) && !existing.revokedAt &&
        existing.finalizationId === bill.currentFinalizationId &&
        now.getTime() < getShareExpiry(existing, config.share.expiryDays)) {
        return { shareToken: signShareToken(existing.shareId), shareRecord: existing, bill };
      }
      assertShareRevision(bill, params.expectedRevision);
      if (oldShareSnap.exists) tx.update(oldShareRef, { revokedAt: nowIso });
    } else {
      assertShareRevision(bill, params.expectedRevision);
    }

    const shareId = generateRandomShareId();
    const shareRecord = buildShareData(bill, snapshot, shareId);
    const updatedBill: BillDocument = {
      ...bill,
      activeShareId: shareId,
      revision: bill.revision + 1,
      updatedAt: nowIso,
    };

    tx.set(firestore.collection("shares").doc(shareId), shareRecord);
    tx.set(billRef, updatedBill);

    return {
      shareToken: signShareToken(shareId),
      shareRecord,
      bill: updatedBill,
    };
  });
}

/**
 * Mencabut link hasil publik secara instan.
 */
export async function revokeBillShareLink(params: {
  billId: string;
  ownerUid: string;
}): Promise<BillDocument> {
  const config = getServerConfig();
  const nowIso = new Date().toISOString();

  if (config.isDevSandbox) {
    const db = readDevDb();
    const bill = db.bills[params.billId];
    if (!bill) {
      throw new AppServiceError(404, "BILL_NOT_FOUND", "Tagihan tidak ditemukan.");
    }
    if (bill.ownerUid !== params.ownerUid) {
      throw new AppServiceError(403, "FORBIDDEN", "Akses ditolak.");
    }
    if (bill.activeShareId && db.shares[bill.activeShareId]) {
      db.shares[bill.activeShareId].revokedAt = nowIso;
    }
    const updated: BillDocument = {
      ...bill,
      activeShareId: null,
      revision: bill.revision + 1,
      updatedAt: nowIso,
    };
    db.bills[params.billId] = updated;
    writeDevDb(db);
    return structuredClone(updated);
  }

  const firestore = getAdminFirestore();
  const billRef = firestore.collection("bills").doc(params.billId);

  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(billRef);
    if (!snap.exists) {
      throw new AppServiceError(404, "BILL_NOT_FOUND", "Tagihan tidak ditemukan.");
    }
    const bill = snap.data() as BillDocument;
    if (bill.ownerUid !== params.ownerUid) {
      throw new AppServiceError(403, "FORBIDDEN", "Akses ditolak.");
    }
    if (bill.activeShareId) {
      const shareRef = firestore.collection("shares").doc(bill.activeShareId);
      tx.update(shareRef, { revokedAt: nowIso });
    }
    const updated: BillDocument = {
      ...bill,
      activeShareId: null,
      revision: bill.revision + 1,
      updatedAt: nowIso,
    };
    tx.set(billRef, updated);
    return updated;
  });
}

/**
 * Menghapus tagihan dengan menutup seluruh akses publik lebih dulu.
 */
export async function deleteBillForOwner(params: {
  billId: string;
  ownerUid: string;
}): Promise<void> {
  const config = getServerConfig();
  const nowIso = new Date().toISOString();

  if (config.isDevSandbox) {
    await productTransaction(async tx => {
      const bill = await tx.get<BillDocument>("bills", params.billId);
      if (!bill) return;
      if (bill.ownerUid !== params.ownerUid) throw new AppServiceError(403, "FORBIDDEN", "Akses ditolak.");
      const photo = bill.receiptPhotoId ? await tx.get<import("@/domain/receipts").ReceiptPhotoRecord>("receiptPhotos", bill.receiptPhotoId) : null;
      await syncQrisReferences(tx, params.ownerUid, billQrisIds(bill), []);
      const db = readDevDb();
      for (const share of Object.values(db.shares)) if (share.billId === bill.id) tx.delete("shares", share.shareId);
      for (const fin of Object.values(db.finalizations)) if (fin.billId === bill.id) tx.delete("finalizations", fin.id);
      for (const attempt of Object.values(db.scanAttempts)) if (attempt.billId === bill.id && !isScanStillRunning(attempt)) tx.delete("scanAttempts", attempt.id);
      if (photo) tx.set("receiptPhotos", photo.id, { ...photo, status: "cleanup_pending", nextCleanupAt: nowIso });
      tx.delete("bills", bill.id);
    });
    return;
  }

  const firestore = getAdminFirestore();
  const billRef = firestore.collection("bills").doc(params.billId);
  const billSnap = await billRef.get();
  if (!billSnap.exists) return;

  const bill = billSnap.data() as BillDocument;
  if (bill.ownerUid !== params.ownerUid) {
    throw new AppServiceError(403, "FORBIDDEN", "Akses ditolak.");
  }

  // Delete the parent transactionally first. Concurrent draft saves/scans cannot recreate it.
  await firestore.runTransaction(async tx => {
    const current = await tx.get(billRef);
    if (!current.exists) return;
    if ((current.data() as BillDocument).ownerUid !== params.ownerUid) throw new AppServiceError(403, "FORBIDDEN", "Akses ditolak.");
    const photoId = (current.data() as BillDocument).receiptPhotoId;
    const photoRef = photoId ? firestore.collection("receiptPhotos").doc(photoId) : null;
    const photo = photoRef ? await tx.get(photoRef) : null;
    await syncQrisReferences(firestoreProductTransaction(tx), params.ownerUid, billQrisIds(current.data() as BillDocument), []);
    if (photo?.exists && photoRef) tx.update(photoRef, { status: "cleanup_pending", nextCleanupAt: nowIso });
    tx.delete(billRef);
  });
  const shares = await firestore.collection("shares").where("billId", "==", params.billId).get();
  const finals = await billRef.collection("finalizations").get();
  const scans = await firestore.collection("scanAttempts").where("billId", "==", params.billId).get();
  const removable = [...shares.docs, ...finals.docs, ...scans.docs.filter(doc => !isScanStillRunning(doc.data() as ScanAttemptRecord))];
  // Bound write batches for old histories, too.
  for (let offset = 0; offset < removable.length; offset += 400) {
    const batch = firestore.batch();
    removable.slice(offset, offset + 400).forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
}

/**
 * Membaca dan memvalidasi proyeksi publik dari token /s/[token].
 * Memeriksa signature, expiry, revocation, keberadaan bill, status finalized, dan allowlist owner!
 */
export async function resolvePublicShareToken(
  token: string
): Promise<PublicShareProjection | null> {
  const config = getServerConfig();
  // The deployment switch also blocks existing links before any database access.
  if (!config.share.linksEnabled || !config.share.isConfigured) return null;

  const shareId = verifyShareTokenSignature(token);
  if (!shareId) return null;

  let share: ShareRecord | undefined;
  let bill: BillDocument | undefined;

  if (config.isDevSandbox) {
    const db = readDevDb();
    share = db.shares[shareId];
    if (share) {
      bill = db.bills[share.billId];
    }
  } else {
    const firestore = getAdminFirestore();
    const shareDoc = await firestore.collection("shares").doc(shareId).get();
    if (shareDoc.exists) {
      share = shareDoc.data() as ShareRecord;
      const billDoc = await firestore.collection("bills").doc(share.billId).get();
      if (billDoc.exists) {
        bill = billDoc.data() as BillDocument;
      }
    }
  }

  if (!share || !bill) return null;
  if (share.revokedAt) return null;
  // Cap existing 30-day records too, without rewriting stored share documents.
  const effectiveExpiry = getShareExpiry(share, config.share.expiryDays);
  if (!Number.isFinite(effectiveExpiry) || Date.now() >= effectiveExpiry) return null;
  if (bill.status !== "finalized") return null;
  if (bill.activeShareId !== share.shareId) return null;
  if (bill.currentFinalizationId !== share.finalizationId) return null;

  // Pastikan pemilik tagihan masih diizinkan oleh deployment
  if (!await hasProductAccess(bill.ownerUid, bill.ownerVerifiedEmail)) {
    return null;
  }

  let snapshot = bill.finalResult;
  if (!snapshot || snapshot.id !== share.finalizationId) {
    if (config.isDevSandbox) snapshot = readDevDb().finalizations[share.finalizationId];
    else {
      const doc = await getAdminFirestore().collection("bills").doc(bill.id).collection("finalizations").doc(share.finalizationId).get();
      snapshot = doc.exists ? doc.data() as FinalizationSnapshot : undefined;
    }
  }
  if (!snapshot && !share.publicProjection) return null;
  const projection: PublicShareProjection = snapshot ? {
    shareId: share.shareId, billId: bill.id,
    finalizationVersion: snapshot.versionNumber, calculationVersion: snapshot.calculationVersion,
    title: snapshot.title, merchant: snapshot.merchant, receiptDate: snapshot.receiptDate, currency: snapshot.currency,
    grandTotal: snapshot.calculationResult.computedGrandTotal,
    payerName: snapshot.inputSnapshot.participants.find(p => p.id === snapshot!.inputSnapshot.payerParticipantId)?.name ?? "Pembayar",
    totalReceivableByPayer: snapshot.calculationResult.totalReceivableByPayer,
    participants: buildDetailedParticipantShares(snapshot.inputSnapshot, snapshot.calculationResult),
    receiptDetails: buildReceiptDetails(snapshot.inputSnapshot, snapshot.calculationResult),
    paymentMethods: normalizePaymentMethods(snapshot.paymentMethods, snapshot.paymentNote),
    finalizedAt: snapshot.finalizedAt, expiresAt: new Date(effectiveExpiry).toISOString(),
  } : { ...structuredClone(share.publicProjection!), expiresAt: new Date(effectiveExpiry).toISOString() };
  if (snapshot?.shareReceiptPhoto) await addPublicPhotoInfo(projection, bill, snapshot.receiptPhotoId);
  return projection;
}

function assertScannableBill(bill: BillDocument, expectedRevision: number): void {
  if (bill.receiptPhotoUploadId) throw new AppServiceError(409, "PHOTO_UPLOAD_IN_PROGRESS", "Foto masih disimpan. Tunggu sebelum membaca struk.");
  if (bill.status !== "draft") {
    throw new AppServiceError(409, "BILL_FINALIZED", "Pilih Ubah tagihan sebelum membaca struk baru.");
  }
  if (bill.revision !== expectedRevision) {
    throw new AppServiceError(409, "REVISION_CONFLICT", "Tagihan sudah berubah. Muat ulang sebelum membaca struk.");
  }
}

function assertUserScanConcurrency(usage: UsageBucketRecord, ownerUid: string, maximum: number): void {
  // Legacy leases without owner metadata count conservatively until expiry.
  const activeForUser = Object.keys(usage.activeLeases).filter((id) =>
    !usage.activeLeaseOwners?.[id] || usage.activeLeaseOwners[id] === ownerUid
  ).length;
  if (activeForUser >= maximum) {
    throw new AppServiceError(429, "USER_CONCURRENCY_LIMIT", "Akun ini masih memiliki pembacaan struk yang berjalan. Tunggu sampai selesai.");
  }
}

function carryRecentLeases(usage: UsageBucketRecord, previous: UsageBucketRecord | undefined, nowMs: number): void {
  for (const [id, expiresAt] of Object.entries(previous?.activeLeases ?? {})) {
    if (expiresAt > nowMs && !usage.activeLeases[id]) {
      usage.activeLeases[id] = expiresAt;
      const owner = previous?.activeLeaseOwners?.[id];
      if (owner) {
        usage.activeLeaseOwners ??= {};
        usage.activeLeaseOwners[id] = owner;
      }
    }
  }
}

/**
 * Reservasi Kuota Scan Gemini Secara Atomik (Sebelum Provider Call)
 *
 * Sesuai .agents/plan/05-access-security-cost.md Bagian 6:
 * - Memeriksa kill switch GEMINI_SCAN_ENABLED.
 * - Memeriksa idempotency key + imageHash.
 * - Memeriksa kuota bulanan per akun, rate limit per menit,
 *   batas attempt per bill, dan concurrency lease aktif.
 */
export async function reserveScanAttempt(params: {
  ownerUid: string;
  billId: string;
  expectedRevision: number;
  idempotencyKey: string;
  imageHash: string;
  model: string;
  promptVersion: string;
  requestId?: string;
}): Promise<{ attempt: ScanAttemptRecord; isDuplicate: boolean }> {
  const config = getServerConfig();
  if (!config.gemini.scanEnabled) {
    throw new AppServiceError(
      503,
      "SCAN_DISABLED",
      "Baca struk sedang tidak tersedia. Kamu tetap bisa isi manual."
    );
  }

  const idempotencyDigest = crypto
    .createHash("sha256")
    .update(`${params.ownerUid}:${params.billId}:${params.idempotencyKey}`)
    .digest("hex")
    .slice(0, 32);

  const attemptId = `scan_${idempotencyDigest}`;
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const dateKey = getCurrentDateKeyInTimezone(config.limits.usageTimezone, new Date(nowMs)).slice(0, 7);
  const minuteBucket = `${params.ownerUid}_${Math.floor(nowMs / 60_000)}`;
  const leaseDurationMs = 60_000; // 60 detik lease maksimum
  const recentDateKey = getCurrentDateKeyInTimezone(config.limits.usageTimezone, new Date(nowMs - leaseDurationMs)).slice(0, 7);

  if (config.isDevSandbox) {
    const db = readDevDb();
    const bill = db.bills[params.billId];
    if (!bill) {
      throw new AppServiceError(404, "BILL_NOT_FOUND", "Tagihan tidak ditemukan.");
    }
    if (bill.ownerUid !== params.ownerUid) {
      throw new AppServiceError(403, "FORBIDDEN", "Akses ditolak.");
    }

    const existing = db.scanAttempts[attemptId];
    if (existing) {
      if (existing.imageHash !== params.imageHash) {
        throw new AppServiceError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key yang sama digunakan untuk gambar yang berbeda."
        );
      }
      return { attempt: structuredClone(existing), isDuplicate: true };
    }

    assertScannableBill(bill, params.expectedRevision);

    const billAttempts = Object.values(db.scanAttempts).filter(
      (a) => a.billId === params.billId
    );
    if (billAttempts.length >= config.limits.maxAttemptsPerBill) {
      throw new AppServiceError(
        429,
        "BILL_ATTEMPT_LIMIT_REACHED",
        `Batas ${config.limits.maxAttemptsPerBill} kali scan untuk tagihan ini sudah tercapai. Kamu tetap bisa mengedit pesanan.`
      );
    }

    const account = db.users[params.ownerUid];
    if (account && !isAdmin(account) && !accountIsActive(account)) throw new AppServiceError(403, "ACCESS_REQUIRED", "Akses akun tidak aktif.");
    const usage = db.usageMonths[dateKey] ?? {
      dateKey,
      deploymentAttempts: 0,
      activeLeases: {},
      userAttempts: {},
      userMinuteWindows: {},
    };

    // Bersihkan lease yang sudah kedaluwarsa
    for (const [leaseId, exp] of Object.entries(usage.activeLeases)) {
      if (nowMs > exp) {
        delete usage.activeLeases[leaseId];
        if (usage.activeLeaseOwners) delete usage.activeLeaseOwners[leaseId];
      }
    }

    if (recentDateKey !== dateKey) carryRecentLeases(usage, db.usageMonths[recentDateKey], nowMs);
    assertUserScanConcurrency(usage, params.ownerUid, config.limits.maxActivePerUser);

    const activeCount = Object.keys(usage.activeLeases).length;
    if (activeCount >= config.limits.maxActivePerDeployment) {
      throw new AppServiceError(
        429,
        "CONCURRENCY_LIMIT",
        "Sedang ada pembacaan struk yang masih berlangsung. Tunggu beberapa detik."
      );
    }

    const userDayCount = usage.userAttempts[params.ownerUid] ?? 0;
    if (userDayCount >= (account?.monthlyLimit ?? config.limits.monthlyUserLimit) + (usage.userBonuses?.[params.ownerUid] ?? 0)) {
      throw new AppServiceError(
        429,
        "MONTHLY_QUOTA_REACHED",
        "Kuota scan bulan ini sudah habis. Kuota diperbarui tanggal 1 pukul 00.00 WITA. Kamu tetap bisa isi manual."
      );
    }

    const userMinCount = usage.userMinuteWindows[minuteBucket] ?? 0;
    if (userMinCount >= config.limits.perMinuteUserLimit) {
      throw new AppServiceError(
        429,
        "RATE_LIMIT_MINUTE",
        `Terlalu banyak percobaan scan dalam satu menit (maksimum ${config.limits.perMinuteUserLimit}x/menit). Tunggu sebentar.`
      );
    }

    // Reserve slot secara atomik
    pruneMinuteWindows(usage, nowMs);
    usage.deleteAfter = retentionDate(dateKey);
    usage.deploymentAttempts += 1;
    usage.userAttempts[params.ownerUid] = userDayCount + 1;
    usage.userMinuteWindows[minuteBucket] = userMinCount + 1;
    usage.activeLeases[attemptId] = nowMs + leaseDurationMs;
    usage.activeLeaseOwners ??= {};
    usage.activeLeaseOwners[attemptId] = params.ownerUid;
    bill.scanAttemptCount = billAttempts.length + 1;
    db.usageMonths[dateKey] = usage;

    const attempt: ScanAttemptRecord = {
      id: attemptId,
      ownerUid: params.ownerUid,
      billId: params.billId,
      billRevisionAtStart: bill.revision,
      imageHash: params.imageHash,
      model: params.model,
      promptVersion: params.promptVersion,
      state: "dispatched",
      reservedAt: nowIso,
      dispatchedAt: nowIso,
      usageMonthKey: dateKey,
      deleteAfter: new Date(nowMs + 30 * 86400000),
      completedAt: null,
      errorCode: null,
      errorMessage: null,
      requestId: params.requestId ?? null,
      extractedData: null,
    };

    db.scanAttempts[attemptId] = attempt;
    const monitorId = summaryId(params.ownerUid, dateKey);
    db.adminUserMonths[monitorId] = makeSummary(db.adminUserMonths[monitorId], {
      uid: params.ownerUid, monthKey: dateKey, used: usage.userAttempts[params.ownerUid],
      limit: account?.monthlyLimit ?? config.limits.monthlyUserLimit,
      bonus: usage.userBonuses?.[params.ownerUid] ?? 0, now: nowIso,
    });
    writeDevDb(db);
    return { attempt: structuredClone(attempt), isDuplicate: false };
  }

  // Jalur Firestore Transaction
  const firestore = getAdminFirestore();
  const attemptRef = firestore.collection("scanAttempts").doc(attemptId);
  const billRef = firestore.collection("bills").doc(params.billId);
  const usageRef = firestore.collection("usageMonths").doc(dateKey);
  const summaryRef = firestore.collection("adminUserMonths").doc(summaryId(params.ownerUid, dateKey));

  return firestore.runTransaction(async (tx) => {
    const [billSnap, attemptSnap, usageSnap, recentUsageSnap, accountSnap, summarySnap] = await Promise.all([
      tx.get(billRef),
      tx.get(attemptRef),
      tx.get(usageRef),
      recentDateKey !== dateKey
        ? tx.get(firestore.collection("usageMonths").doc(recentDateKey))
        : Promise.resolve(undefined),
      tx.get(firestore.collection("users").doc(params.ownerUid)),
      tx.get(summaryRef),
    ]);
    const account = accountSnap.exists ? accountSnap.data() as import("../access/types").UserAccount : null;
    if (account && !isAdmin(account) && !accountIsActive(account)) throw new AppServiceError(403, "ACCESS_REQUIRED", "Akses akun tidak aktif.");

    if (!billSnap.exists) {
      throw new AppServiceError(404, "BILL_NOT_FOUND", "Tagihan tidak ditemukan.");
    }
    const bill = billSnap.data() as BillDocument;
    if (bill.ownerUid !== params.ownerUid) {
      throw new AppServiceError(403, "FORBIDDEN", "Akses ditolak.");
    }

    if (attemptSnap.exists) {
      const existing = attemptSnap.data() as ScanAttemptRecord;
      if (existing.imageHash !== params.imageHash) {
        throw new AppServiceError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key yang sama digunakan untuk gambar yang berbeda."
        );
      }
      return { attempt: existing, isDuplicate: true };
    }

    assertScannableBill(bill, params.expectedRevision);
    // Older bills have no counter: recover it once from their attempt records.
    const billAttemptCount = bill.scanAttemptCount ?? (await tx.get(
      firestore.collection("scanAttempts")
        .where("billId", "==", params.billId)
        .limit(config.limits.maxAttemptsPerBill)
    )).size;
    if (billAttemptCount >= config.limits.maxAttemptsPerBill) {
      throw new AppServiceError(429, "BILL_ATTEMPT_LIMIT_REACHED", `Batas ${config.limits.maxAttemptsPerBill} kali scan untuk tagihan ini sudah tercapai. Kamu tetap bisa mengedit pesanan.`);
    }

    const usage: UsageBucketRecord = usageSnap.exists
      ? (usageSnap.data() as UsageBucketRecord)
      : {
          dateKey,
          deploymentAttempts: 0,
          activeLeases: {},
          userAttempts: {},
          userMinuteWindows: {},
        };

    for (const [leaseId, exp] of Object.entries(usage.activeLeases)) {
      if (nowMs > exp) {
        delete usage.activeLeases[leaseId];
        if (usage.activeLeaseOwners) delete usage.activeLeaseOwners[leaseId];
      }
    }

    if (recentUsageSnap?.exists) carryRecentLeases(usage, recentUsageSnap.data() as UsageBucketRecord, nowMs);
    assertUserScanConcurrency(usage, params.ownerUid, config.limits.maxActivePerUser);

    if (
      Object.keys(usage.activeLeases).length >=
      config.limits.maxActivePerDeployment
    ) {
      throw new AppServiceError(
        429,
        "CONCURRENCY_LIMIT",
        "Sedang ada pembacaan struk yang masih berlangsung. Tunggu beberapa detik."
      );
    }

    const userDayCount = usage.userAttempts[params.ownerUid] ?? 0;
    if (userDayCount >= (account?.monthlyLimit ?? config.limits.monthlyUserLimit) + (usage.userBonuses?.[params.ownerUid] ?? 0)) {
      throw new AppServiceError(
        429,
        "MONTHLY_QUOTA_REACHED",
        "Kuota scan bulan ini sudah habis. Kuota diperbarui tanggal 1 pukul 00.00 WITA. Kamu tetap bisa isi manual."
      );
    }

    const userMinCount = usage.userMinuteWindows[minuteBucket] ?? 0;
    if (userMinCount >= config.limits.perMinuteUserLimit) {
      throw new AppServiceError(
        429,
        "RATE_LIMIT_MINUTE",
        `Terlalu banyak percobaan scan dalam satu menit (maksimum ${config.limits.perMinuteUserLimit}x/menit).`
      );
    }

    pruneMinuteWindows(usage, nowMs);
    usage.deleteAfter = retentionDate(dateKey);
    usage.deploymentAttempts += 1;
    usage.userAttempts[params.ownerUid] = userDayCount + 1;
    usage.userMinuteWindows[minuteBucket] = userMinCount + 1;
    usage.activeLeases[attemptId] = nowMs + leaseDurationMs;
    usage.activeLeaseOwners ??= {};
    usage.activeLeaseOwners[attemptId] = params.ownerUid;

    const attempt: ScanAttemptRecord = {
      id: attemptId,
      ownerUid: params.ownerUid,
      billId: params.billId,
      billRevisionAtStart: bill.revision,
      imageHash: params.imageHash,
      model: params.model,
      promptVersion: params.promptVersion,
      state: "dispatched",
      reservedAt: nowIso,
      dispatchedAt: nowIso,
      usageMonthKey: dateKey,
      deleteAfter: new Date(nowMs + 30 * 86400000),
      completedAt: null,
      errorCode: null,
      errorMessage: null,
      requestId: params.requestId ?? null,
      extractedData: null,
    };

    tx.set(usageRef, usage);
    tx.set(attemptRef, attempt);
    tx.set(summaryRef, makeSummary(summarySnap.exists ? summarySnap.data() as UserMonthSummary : null, {
      uid: params.ownerUid, monthKey: dateKey, used: usage.userAttempts[params.ownerUid],
      limit: account?.monthlyLimit ?? config.limits.monthlyUserLimit,
      bonus: usage.userBonuses?.[params.ownerUid] ?? 0, now: nowIso,
    }));
    tx.update(billRef, { scanAttemptCount: billAttemptCount + 1 });
    return { attempt, isDuplicate: false };
  });
}

/**
 * Menyelesaikan status scan attempt dan melepas lease concurrency (tanpa mengembalikan kuota bulanan!).
 */
export async function completeScanAttempt(params: {
  attemptId: string;
  state: "succeeded" | "failed" | "unknown";
  extractedData?: ExtractedReceiptSuggestion | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  applyToBillIfRevisionMatches?: boolean;
}): Promise<{
  attempt: ScanAttemptRecord;
  appliedToBill: boolean;
  updatedBill?: BillDocument;
}> {
  const config = getServerConfig();
  const nowIso = new Date().toISOString();

  if (config.isDevSandbox) {
    const db = readDevDb();
    const attempt = db.scanAttempts[params.attemptId];
    if (!attempt) {
      throw new AppServiceError(
        404,
        "ATTEMPT_NOT_FOUND",
        "Catatan scan tidak ditemukan."
      );
    }

    // First completion wins. Retries must not count results or apply OCR twice.
    if (attempt.completedAt) return { attempt: structuredClone(attempt), appliedToBill: false };

    attempt.state = params.state;
    attempt.completedAt = nowIso;
    attempt.extractedData = params.extractedData ?? null;
    attempt.errorCode = params.errorCode ?? null;
    attempt.errorMessage = params.errorMessage ?? null;

    const usageKey = attempt.usageMonthKey ?? attempt.usageDateKey ?? getCurrentDateKeyInTimezone(config.limits.usageTimezone, new Date(attempt.reservedAt));
    const usageBuckets = attempt.usageMonthKey ? db.usageMonths : db.usageDays;
    if (attempt.usageMonthKey) {
      const usage = usageBuckets[usageKey];
      const account = db.users[attempt.ownerUid];
      const monitorId = summaryId(attempt.ownerUid, usageKey);
      db.adminUserMonths[monitorId] = makeSummary(db.adminUserMonths[monitorId], {
        uid: attempt.ownerUid, monthKey: usageKey, used: usage?.userAttempts[attempt.ownerUid] ?? 0,
        limit: account?.monthlyLimit ?? config.limits.monthlyUserLimit,
        bonus: usage?.userBonuses?.[attempt.ownerUid] ?? 0, now: nowIso,
      }, params.state);
    }
    if (usageBuckets[usageKey]?.activeLeases) {
      delete usageBuckets[usageKey].activeLeases[params.attemptId];
      if (usageBuckets[usageKey].activeLeaseOwners) {
        delete usageBuckets[usageKey].activeLeaseOwners[params.attemptId];
      }
    }

    let appliedToBill = false;
    let updatedBill: BillDocument | undefined;

    const bill = db.bills[attempt.billId];
    const ownerHasAccess = bill ? await hasProductAccess(bill.ownerUid, bill.ownerVerifiedEmail) : false;
    if (
      params.state === "succeeded" &&
      params.extractedData &&
      params.applyToBillIfRevisionMatches !== false &&
      bill &&
      ownerHasAccess &&
      bill.status === "draft" &&
      bill.revision === attempt.billRevisionAtStart
    ) {
      const ext = params.extractedData;
      const newAllocations: ItemAllocation[] = ext.items.map((it) => ({
        itemId: it.id,
        mode: "units",
        unitCounts: {},
      }));

      updatedBill = {
        ...bill,
        revision: bill.revision + 1,
        merchant: ext.merchant || bill.merchant,
        receiptDate: ext.receiptDate || bill.receiptDate,
        items: ext.items,
        adjustments: ext.adjustments,
        allocations: newAllocations,
        confirmedGrandTotal: ext.printedGrandTotal,
        observedGrandTotal: ext.printedGrandTotal,
        receiptSourceType: ext.sourceType ?? "printed_receipt",
        extractionWarnings: ext.warnings,
        printedSubtotal: ext.printedSubtotal ?? null,
        confirmedInputHash: null, // Wajib direview manusia terlebih dahulu!
        updatedAt: nowIso,
      };
      db.bills[bill.id] = updatedBill;
      appliedToBill = true;
    }

    if (params.state === "succeeded") attempt.applicationOutcome = appliedToBill ? "applied"
      : !bill ? "bill_deleted" : !ownerHasAccess ? "access_inactive"
      : bill.status !== "draft" ? "bill_finalized" : bill.revision !== attempt.billRevisionAtStart ? "draft_changed" : "not_requested";
    if (!bill) delete db.scanAttempts[params.attemptId];
    writeDevDb(db);
    return {
      attempt: structuredClone(attempt),
      appliedToBill,
      updatedBill: updatedBill ? structuredClone(updatedBill) : undefined,
    };
  }

  const firestore = getAdminFirestore();
  const attemptRef = firestore.collection("scanAttempts").doc(params.attemptId);
  return firestore.runTransaction(async (tx) => {
    const attemptSnap = await tx.get(attemptRef);
    if (!attemptSnap.exists) {
      throw new AppServiceError(
        404,
        "ATTEMPT_NOT_FOUND",
        "Catatan scan tidak ditemukan."
      );
    }
    const attempt = attemptSnap.data() as ScanAttemptRecord;
    if (attempt.completedAt) return { attempt, appliedToBill: false };
    const usageKey = attempt.usageMonthKey ?? attempt.usageDateKey ?? getCurrentDateKeyInTimezone(config.limits.usageTimezone, new Date(attempt.reservedAt));
    const usageRef = firestore.collection(attempt.usageMonthKey ? "usageMonths" : "usageDays").doc(usageKey);
    const billRef = firestore.collection("bills").doc(attempt.billId);
    const summaryRef = attempt.usageMonthKey
      ? firestore.collection("adminUserMonths").doc(summaryId(attempt.ownerUid, usageKey)) : null;
    const [billSnap, usageSnap, accountSnap, summarySnap] = await Promise.all([
      tx.get(billRef),
      tx.get(usageRef),
      tx.get(firestore.collection("users").doc(attempt.ownerUid)),
      summaryRef ? tx.get(summaryRef) : Promise.resolve(null),
    ]);

    const billOwner = billSnap.exists ? billSnap.data() as BillDocument : null;
    const account = accountSnap.exists ? accountSnap.data() as import("../access/types").UserAccount : null;
    const mayApply = !!billOwner && (isAdmin({ uid: attempt.ownerUid, email: billOwner.ownerVerifiedEmail }) || (account ? accountIsActive(account) : config.allowedEmails.has(billOwner.ownerVerifiedEmail)));

    const updatedAttempt: ScanAttemptRecord = {
      ...attempt,
      state: params.state,
      completedAt: nowIso,
      extractedData: params.extractedData ?? null,
      errorCode: params.errorCode ?? null,
      errorMessage: params.errorMessage ?? null,
    };
    if (summaryRef) {
      const usage = usageSnap.data() as UsageBucketRecord | undefined;
      tx.set(summaryRef, makeSummary(summarySnap?.exists ? summarySnap.data() as UserMonthSummary : null, {
        uid: attempt.ownerUid, monthKey: usageKey, used: usage?.userAttempts[attempt.ownerUid] ?? 0,
        limit: account?.monthlyLimit ?? config.limits.monthlyUserLimit,
        bonus: usage?.userBonuses?.[attempt.ownerUid] ?? 0, now: nowIso,
      }, params.state));
    }

    if (usageSnap.exists) {
      const usage = usageSnap.data() as UsageBucketRecord;
      if (usage.activeLeases?.[params.attemptId]) {
        delete usage.activeLeases[params.attemptId];
        if (usage.activeLeaseOwners) delete usage.activeLeaseOwners[params.attemptId];
        tx.set(usageRef, usage);
      }
    }

    let appliedToBill = false;
    let updatedBill: BillDocument | undefined;

    if (
      params.state === "succeeded" &&
      params.extractedData &&
      params.applyToBillIfRevisionMatches !== false &&
      billSnap.exists && mayApply
    ) {
      const bill = billSnap.data() as BillDocument;
      if (
        bill.status === "draft" &&
        bill.revision === attempt.billRevisionAtStart
      ) {
        const ext = params.extractedData;
        const newAllocations: ItemAllocation[] = ext.items.map((it) => ({
          itemId: it.id,
          mode: "units",
          unitCounts: {},
        }));

        updatedBill = {
          ...bill,
          revision: bill.revision + 1,
          merchant: ext.merchant || bill.merchant,
          receiptDate: ext.receiptDate || bill.receiptDate,
          items: ext.items,
          adjustments: ext.adjustments,
          allocations: newAllocations,
          confirmedGrandTotal: ext.printedGrandTotal,
          observedGrandTotal: ext.printedGrandTotal,
          receiptSourceType: ext.sourceType ?? "printed_receipt",
          extractionWarnings: ext.warnings,
          printedSubtotal: ext.printedSubtotal ?? null,
          confirmedInputHash: null,
          updatedAt: nowIso,
        };
        tx.set(billRef, updatedBill);
        appliedToBill = true;
      }
    }

    if (params.state === "succeeded") updatedAttempt.applicationOutcome = appliedToBill ? "applied"
      : !billOwner ? "bill_deleted" : !mayApply ? "access_inactive"
      : billOwner.status !== "draft" ? "bill_finalized" : billOwner.revision !== attempt.billRevisionAtStart ? "draft_changed" : "not_requested";
    if (!billSnap.exists) tx.delete(attemptRef);
    else tx.set(attemptRef, updatedAttempt);
    return { attempt: updatedAttempt, appliedToBill, updatedBill };
  });
}

/**
 * Mengambil ringkasan pemakaian kuota scan bulan ini untuk ditampilkan dengan jujur di UI.
 */
async function getMonthlyUsage(key: string): Promise<UsageBucketRecord | undefined> {
  const config = getServerConfig();
  if (config.isDevSandbox) return readDevDb().usageMonths[key];
  const doc = await getAdminFirestore().collection("usageMonths").doc(key).get();
  return doc.exists ? doc.data() as UsageBucketRecord : undefined;
}
function quotaSummary(ownerUid: string, account: import("../access/types").UserAccount | null, usage: UsageBucketRecord | undefined, key: string) {
  const config = getServerConfig();
  const usedThisMonth = usage?.userAttempts?.[ownerUid] ?? 0;
  const monthlyLimit = account?.monthlyLimit ?? config.limits.monthlyUserLimit;
  const bonus = usage?.userBonuses?.[ownerUid] ?? 0;
  return { scanEnabled: config.gemini.scanEnabled, isConfigured: config.gemini.isConfigured,
    isDevSandbox: config.isDevSandbox, monthKey: key, usedThisMonth, monthlyLimit, bonus,
    remaining: Math.max(0, monthlyLimit + bonus - usedThisMonth), usageTimezone: config.limits.usageTimezone };
}
export async function getScanQuotaStatus(ownerUid: string) {
  const key = getCurrentDateKeyInTimezone("Asia/Makassar").slice(0, 7);
  const [account, usage] = await Promise.all([getAccount(ownerUid), getMonthlyUsage(key)]);
  return quotaSummary(ownerUid, account, usage, key);
}
export async function getScanQuotaStatuses(accounts: import("../access/types").UserAccount[]) {
  const key = getCurrentDateKeyInTimezone("Asia/Makassar").slice(0, 7);
  const usage = await getMonthlyUsage(key);
  return accounts.map(account => ({ uid: account.uid, ...quotaSummary(account.uid, account, usage, key) }));
}

function pruneMinuteWindows(usage: UsageBucketRecord, nowMs: number) {
  const current = Math.floor(nowMs / 60000);
  for (const key of Object.keys(usage.userMinuteWindows)) {
    if (Number(key.slice(key.lastIndexOf("_") + 1)) < current - 1) delete usage.userMinuteWindows[key];
  }
}

function isScanStillRunning(attempt: ScanAttemptRecord) {
  return ["reserved", "dispatched"].includes(attempt.state) && Date.now() < Date.parse(attempt.reservedAt) + 60000;
}
