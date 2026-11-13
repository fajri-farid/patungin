import { afterEach, describe, expect, it, vi } from "vitest";
const { documents, firestore } = await vi.hoisted(async () => {
  const { createFirestoreFake } = await import("./helpers/firestore");
  return createFirestoreFake();
});
vi.mock("../src/server/firebase/admin", () => ({
  getAdminFirestore: () => firestore,
}));
import {
  billTrackingView,
  participantPaymentLabel,
  snapshotObligations,
  trackingLabel,
  trackingView,
} from "../src/domain/billing/tracking";
import {
  updatePaymentTracking,
  type TrackingMutation,
} from "../src/server/payments/tracking";
import {
  createDraftBill,
  saveBillDraft,
  finalizeBillOnServer,
  publishBillShareLink,
  revokeBillShareLink,
  reopenBillToDraft,
  resolvePublicShareToken,
  deleteBillForOwner,
} from "../src/server/store/repository";
import { readDevDb, writeDevDb } from "../src/server/store/dev-database";
import { summarizeBill } from "../src/domain/billing/summary";
import type { BillDocument } from "../src/domain/billing/types";
const ownerUid = "dev-uid-host-patungin-local";
const now = "2026-11-12T10:00:00.000Z";
const people = [
  { id: "andi", isPayer: true, transferToPayerAmount: 0 },
  { id: "budi", isPayer: false, transferToPayerAmount: 35000 },
  { id: "citra", isPayer: false, transferToPayerAmount: 50000 },
  { id: "deni", isPayer: false, transferToPayerAmount: 25000 },
  { id: "zero", isPayer: false, transferToPayerAmount: 0 },
];
const entries = Object.fromEntries(
  people
    .filter((p) => p.transferToPayerAmount)
    .map((p) => [
      p.id,
      {
        status: p.id === "budi" ? "paid" : "unpaid",
        paidAt: p.id === "budi" ? now : null,
        updatedAt: now,
      },
    ]),
);
const tracked = {
  schemaVersion: 1,
  finalizationId: "fin",
  startedAt: now,
  updatedAt: now,
  entries,
};
async function fixture() {
  const draft = await createDraftBill({
    ownerUid,
    ownerVerifiedEmail: "host@patungin.local",
    presetCode: "M-01",
  });
  const confirmed = await saveBillDraft(draft.id, ownerUid, {
    expectedRevision: draft.revision,
    markReviewConfirmed: true,
  });
  return (
    await finalizeBillOnServer({
      billId: draft.id,
      ownerUid,
      expectedRevision: confirmed.revision,
    })
  ).bill;
}
const input = (bill: BillDocument): TrackingMutation => ({
  billId: bill.id,
  expectedRevision: bill.revision,
  finalizationId: bill.currentFinalizationId!,
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("payment tracking domain", () => {
  it("uses brief payment labels in cards and details", () => {
    const view = trackingView(tracked, "fin", people);
    expect(participantPaymentLabel(view, people[1], true)).toBe("Lunas");
    expect(participantPaymentLabel(view, people[1])).toContain("Sudah bayar");
  });
  it("uses final obligations and excludes the payer and zero-value participants", () => {
    expect(trackingView(tracked, "fin", people)).toMatchObject({
      state: "active",
      count: 3,
      paidCount: 1,
      total: 110000,
      received: 35000,
      remaining: 75000,
    });
    expect(trackingLabel(trackingView(tracked, "fin", people))).toContain(
      "1/3 lunas",
    );
    expect(trackingView(undefined, "fin", people).state).toBe("inactive");
    expect(
      participantPaymentLabel(
        trackingView(undefined, "fin", people),
        people[1],
      ),
    ).toBe("Status pembayaran belum diisi");
    expect(participantPaymentLabel(undefined, people[0])).toBe(
      "Bagian sendiri",
    );
    expect(participantPaymentLabel(undefined, people[4])).toBe(
      "Tidak perlu transfer",
    );
    expect(trackingLabel(trackingView(undefined, "fin", []))).toBe(
      "Tidak ada yang perlu bayar",
    );
  });
  it.each([
    0,
    [],
    { ...tracked, schemaVersion: 2 },
    { ...tracked, entries: {} },
    { ...tracked, finalizationId: "old" },
    { ...tracked, updatedAt: "invalid" },
    { ...tracked, entries: { ...entries, stranger: entries.budi } },
    {
      ...tracked,
      entries: { ...entries, budi: { ...entries.budi, paidAt: null } },
    },
  ])(
    "rejects malformed persisted data without inventing unpaid status: %#",
    (raw) => {
      expect(trackingView(raw, "fin", people).state).toBe("unavailable");
    },
  );
  it("supports all-paid and 30 participants without denominator errors", () => {
    const all = {
      ...tracked,
      entries: Object.fromEntries(
        Object.keys(entries).map((id) => [
          id,
          { status: "paid", paidAt: now, updatedAt: now },
        ]),
      ),
    };
    expect(trackingView(all, "fin", people)).toMatchObject({
      received: 110000,
      remaining: 0,
      paidCount: 3,
    });
    const large = Array.from({ length: 30 }, (_, i) => ({
      id: `p-${i}`,
      isPayer: i === 0,
      transferToPayerAmount: i === 0 ? 0 : 1000,
    }));
    expect(trackingView(undefined, "fin", large)).toMatchObject({
      count: 29,
      total: 29000,
    });
    expect(trackingView(undefined, "fin", [...large, large[1]]).state).toBe(
      "unavailable",
    );
  });
});

for (const backend of ["sandbox", "firestore"] as const) {
  describe(`${backend} payment transactions`, () => {
    async function setup() {
      const bill = await fixture();
      if (backend === "firestore") {
        documents.set(
          `bills/${bill.id}`,
          structuredClone(bill) as unknown as Record<string, unknown>,
        );
        vi.stubEnv("PATUNGIN_DEV_SANDBOX", "false");
      }
      return bill;
    }
    it("enforces ownership and revision, preserves final figures, and supports undo/re-record", async () => {
      let bill = await setup();
      await expect(
        updatePaymentTracking("attacker", input(bill)),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        updatePaymentTracking(ownerUid, {
          ...input(bill),
          finalizationId: "old",
        }),
      ).rejects.toMatchObject({ code: "FINALIZATION_CHANGED" });
      const immutable = structuredClone(bill.finalResult);
      bill = await updatePaymentTracking(ownerUid, input(bill));
      expect(await updatePaymentTracking(ownerUid, input(bill))).toEqual(bill);
      const participantId = Object.keys(bill.paymentTracking!.entries)[0];
      for (const id of [bill.payerParticipantId!, "unknown"])
        await expect(
          updatePaymentTracking(ownerUid, {
            ...input(bill),
            participantId: id,
            status: "paid",
          }),
        ).rejects.toMatchObject({ code: "INVALID_PARTICIPANT" });
      const stale = input(bill);
      bill = await updatePaymentTracking(ownerUid, {
        ...input(bill),
        participantId,
        status: "paid",
      });
      expect(bill.finalResult).toEqual(immutable);
      expect(
        await updatePaymentTracking(ownerUid, {
          ...input(bill),
          participantId,
          status: "paid",
        }),
      ).toEqual(bill);
      await expect(
        updatePaymentTracking(ownerUid, stale),
      ).rejects.toMatchObject({ code: "STALE_REVISION" });
      await expect(
        reopenBillToDraft({ ...input(bill), ownerUid }),
      ).rejects.toMatchObject({ code: "PAYMENTS_RECORDED" });
      expect(summarizeBill(bill).paymentTrackingLabel).toBe(
        "Semua sudah bayar",
      );
      const firstPaidAt = bill.paymentTracking!.entries[participantId].paidAt;
      bill = await updatePaymentTracking(ownerUid, {
        ...input(bill),
        participantId,
        status: "unpaid",
      });
      expect(bill.paymentTracking!.entries[participantId].paidAt).toBeNull();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 60000);
      bill = await updatePaymentTracking(ownerUid, {
        ...input(bill),
        participantId,
        status: "paid",
      });
      expect(bill.paymentTracking!.entries[participantId].paidAt).not.toBe(
        firstPaidAt,
      );
      bill = await updatePaymentTracking(ownerUid, {
        ...input(bill),
        participantId,
        status: "unpaid",
      });
      const draft = await reopenBillToDraft({ ...input(bill), ownerUid });
      expect(draft.paymentTracking).toBeUndefined();
      expect(draft.status).toBe("draft");
      expect(billTrackingView(draft)).toBeUndefined();
      await expect(
        updatePaymentTracking(ownerUid, input(draft)),
      ).rejects.toMatchObject({ code: "FINALIZATION_CHANGED" });
    });
    it("serializes two writes and a competing reopen without lost updates", async () => {
      let bill = await setup();
      bill = await updatePaymentTracking(ownerUid, input(bill));
      const participantId = Object.keys(bill.paymentTracking!.entries)[0];
      const updates = await Promise.allSettled([
        updatePaymentTracking(ownerUid, {
          ...input(bill),
          participantId,
          status: "paid",
        }),
        updatePaymentTracking(ownerUid, {
          ...input(bill),
          participantId,
          status: "paid",
        }),
        reopenBillToDraft({ ...input(bill), ownerUid }),
      ]);
      expect(updates.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });
  });
}

describe("legacy, share and input boundaries", () => {
  it("refreshes current tracking on the same public token, including legacy projection fallback", async () => {
    const initial = await fixture();
    const shared = await publishBillShareLink({ ...input(initial), ownerUid });
    expect(
      (await resolvePublicShareToken(shared.shareToken))!.paymentTracking!
        .state,
    ).toBe("inactive");
    let bill = await updatePaymentTracking(ownerUid, input(shared.bill));
    const participantId = Object.keys(bill.paymentTracking!.entries)[0];
    bill = await updatePaymentTracking(ownerUid, {
      ...input(bill),
      participantId,
      status: "paid",
    });
    const view = (await resolvePublicShareToken(shared.shareToken))!;
    expect(view.paymentTracking!.paidCount).toBe(1);
    expect(view.paymentTracking!.received).toBe(
      snapshotObligations(bill.finalResult!).find(
        (p) => p.id === participantId,
      )!.transferToPayerAmount,
    );
    expect(JSON.stringify(view.paymentTracking)).not.toContain(ownerUid);
    const repeat = await publishBillShareLink({ ...input(bill), ownerUid });
    expect(repeat.shareToken).toBe(shared.shareToken);
    // Exercise the stored publicProjection fallback without a finalResult.
    const db = readDevDb();
    db.shares[shared.shareRecord.shareId].publicProjection = {
      ...view,
      paymentTracking: undefined,
    };
    delete db.bills[bill.id].finalResult;
    delete db.finalizations[bill.currentFinalizationId!];
    writeDevDb(db);
    expect(
      (await resolvePublicShareToken(shared.shareToken))!.paymentTracking!
        .paidCount,
    ).toBe(1);
    await revokeBillShareLink({ billId: bill.id, ownerUid });
    expect(await resolvePublicShareToken(shared.shareToken)).toBeNull();
  });
  it("loads legacy Firestore snapshots and refuses corrupt tracking without writing", async () => {
    const original = await fixture();
    const legacy = { ...original };
    delete legacy.finalResult;
    documents.set(
      `bills/${legacy.id}`,
      structuredClone(legacy) as unknown as Record<string, unknown>,
    );
    documents.set(
      `bills/${legacy.id}/finalizations/${legacy.currentFinalizationId}`,
      structuredClone(original.finalResult!) as unknown as Record<
        string,
        unknown
      >,
    );
    vi.stubEnv("PATUNGIN_DEV_SANDBOX", "false");
    const bill = await updatePaymentTracking(ownerUid, input(legacy));
    expect(bill.finalResult).toEqual(original.finalResult);
    for (const raw of [
      0,
      { ...bill.paymentTracking, schemaVersion: 99 },
      { ...bill.paymentTracking, entries: {} },
    ]) {
      const corrupt = { ...bill, paymentTracking: raw };
      documents.set(
        `bills/${bill.id}`,
        structuredClone(corrupt) as unknown as Record<string, unknown>,
      );
      await expect(
        updatePaymentTracking(ownerUid, input(bill)),
      ).rejects.toMatchObject({ code: "TRACKING_UNAVAILABLE" });
      await expect(
        reopenBillToDraft({ ...input(bill), ownerUid }),
      ).rejects.toMatchObject({ code: "TRACKING_UNAVAILABLE" });
      expect(documents.get(`bills/${bill.id}`)).toEqual(corrupt);
    }
  });
  it.each([
    { amount: 1 },
    { paidAt: now },
    { ownerUid: "attacker" },
    { status: "invalid", participantId: "p" },
    { status: "paid" },
    { expectedRevision: NaN },
    { billId: "../other" },
  ])("rejects forged mutation fields: %#", async (patch) => {
    const request = {
      billId: "bill",
      expectedRevision: 1,
      finalizationId: "fin",
      ...patch,
    } as TrackingMutation;
    await expect(
      updatePaymentTracking(ownerUid, request),
    ).rejects.toMatchObject({ code: "INVALID_PAYMENT_INPUT" });
  });
  it("keeps expiry independent of tracking, and deletion removes embedded records", async () => {
    const initial = await fixture();
    const shared = await publishBillShareLink({ ...input(initial), ownerUid });
    const bill = await updatePaymentTracking(ownerUid, input(shared.bill));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse(shared.shareRecord.expiresAt));
    expect(await resolvePublicShareToken(shared.shareToken)).toBeNull();
    expect(readDevDb().bills[bill.id].paymentTracking).toBeDefined();
    await deleteBillForOwner({ billId: bill.id, ownerUid });
    expect(readDevDb().bills[bill.id]).toBeUndefined();
  });
});
