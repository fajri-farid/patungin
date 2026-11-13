import { MAX_PARTICIPANTS_COUNT } from "./types";
import type { BillDocument, FinalizationSnapshot } from "./types";
import { formatRupiah } from "./money";

export interface PaymentTracking {
  schemaVersion: 1;
  finalizationId: string;
  startedAt: string;
  updatedAt: string;
  entries: Record<
    string,
    { status: "paid" | "unpaid"; paidAt: string | null; updatedAt: string }
  >;
}
export interface PaymentObligation {
  id: string;
  isPayer: boolean;
  transferToPayerAmount: number;
}
export interface TrackingView {
  state: "inactive" | "active" | "unavailable";
  count: number;
  paidCount: number;
  total: number;
  received: number;
  remaining: number;
  updatedAt: string | null;
  entries: PaymentTracking["entries"];
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const isTime = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

/** Derive money only from final obligations; malformed tracking never means unpaid. */
export function trackingView(
  raw: unknown,
  finalizationId: string,
  people: PaymentObligation[],
): TrackingView {
  const eligible = people.filter(
    (p) => !p.isPayer && p.transferToPayerAmount > 0,
  );
  const total = eligible.reduce((sum, p) => sum + p.transferToPayerAmount, 0);
  const base: TrackingView = {
    state: "inactive",
    count: eligible.length,
    paidCount: 0,
    total,
    received: 0,
    remaining: total,
    updatedAt: null,
    entries: {},
  };
  const unavailable: TrackingView = { ...base, state: "unavailable" };
  if (
    people.length > MAX_PARTICIPANTS_COUNT ||
    new Set(people.map((p) => p.id)).size !== people.length ||
    people.some(
      (p) =>
        !Number.isSafeInteger(p.transferToPayerAmount) ||
        p.transferToPayerAmount < 0,
    ) ||
    !Number.isSafeInteger(total)
  )
    return unavailable;
  if (raw === undefined || raw === null) return base;
  if (
    !isRecord(raw) ||
    raw.schemaVersion !== 1 ||
    raw.finalizationId !== finalizationId ||
    !isTime(raw.startedAt) ||
    !isTime(raw.updatedAt) ||
    !isRecord(raw.entries) ||
    Object.keys(raw.entries).length !== eligible.length
  )
    return unavailable;
  const entries: PaymentTracking["entries"] = Object.create(null);
  let received = 0,
    paidCount = 0;
  for (const person of eligible) {
    const entry = Object.hasOwn(raw.entries, person.id)
      ? raw.entries[person.id]
      : undefined;
    if (
      !isRecord(entry) ||
      (entry.status !== "paid" && entry.status !== "unpaid") ||
      !isTime(entry.updatedAt) ||
      (entry.status === "paid" ? !isTime(entry.paidAt) : entry.paidAt !== null)
    )
      return unavailable;
    entries[person.id] = {
      status: entry.status,
      paidAt: entry.paidAt as string | null,
      updatedAt: entry.updatedAt,
    };
    if (entry.status === "paid") {
      received += person.transferToPayerAmount;
      paidCount++;
    }
  }
  // Plain objects are required at the React Server Component serialization boundary.
  return {
    ...base,
    state: "active",
    entries: { ...entries },
    received,
    remaining: total - received,
    paidCount,
    updatedAt: raw.updatedAt,
  };
}

export function snapshotObligations(
  snapshot: FinalizationSnapshot,
): PaymentObligation[] {
  return snapshot.calculationResult.participantBreakdowns.map((p) => ({
    id: p.participantId,
    isPayer: p.participantId === snapshot.inputSnapshot.payerParticipantId,
    transferToPayerAmount: p.transferToPayerAmount,
  }));
}
export function billTrackingView(bill: BillDocument): TrackingView | undefined {
  if (bill.status !== "finalized") return undefined;
  if (!bill.finalResult || bill.finalResult.id !== bill.currentFinalizationId) {
    return { ...trackingView(undefined, "", []), state: "unavailable" };
  }
  return trackingView(
    bill.paymentTracking,
    bill.currentFinalizationId!,
    snapshotObligations(bill.finalResult),
  );
}
export function trackingLabel(view?: TrackingView): string {
  if (!view) return "";
  if (view.state === "unavailable")
    return "Status pembayaran belum bisa dimuat";
  if (!view.count) return "Tidak ada yang perlu bayar";
  if (view.state === "inactive") return "Status pembayaran belum diisi";
  if (view.paidCount === view.count) return "Semua sudah bayar";
  return `${view.paidCount}/${view.count} lunas · Sisa ${formatRupiah(view.remaining)}`;
}
export function participantPaymentLabel(
  view: TrackingView | undefined,
  person: PaymentObligation,
  compact = false,
): string {
  if (person.isPayer) return "Bagian sendiri";
  if (!person.transferToPayerAmount) return "Tidak perlu transfer";
  if (!view || view.state === "inactive")
    return compact ? "Belum diisi" : "Status pembayaran belum diisi";
  if (view.state === "unavailable")
    return compact
      ? "Status belum bisa dimuat"
      : "Status pembayaran belum bisa dimuat";
  return view.entries[person.id]?.status === "paid"
    ? compact
      ? "Lunas"
      : "Sudah bayar"
    : "Belum bayar";
}
