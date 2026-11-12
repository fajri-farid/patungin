import { describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import sharp from "sharp";
import { parseAllowedEmails } from "../src/server/config/env";
import { validateAndInspectImageBytes } from "../src/server/scans/gemini";
import {
  generateRandomShareId,
  signShareToken,
  verifyShareTokenSignature,
} from "../src/server/shares/token";
import {
  createDraftBill,
  finalizeBillOnServer,
  getCurrentDateKeyInTimezone,
  publishBillShareLink,
  reopenBillToDraft,
  resolvePublicShareToken,
  saveBillDraft,
} from "../src/server/store/repository";

describe("Keamanan Akses, Token Share, Validasi File, & Konkurensi", () => {
  it("blocks existing and new public links while sharing is disabled", async () => {
    const ownerUid = "dev-uid-host-patungin-local";
    const draft = await createDraftBill({ ownerUid, ownerVerifiedEmail: "host@patungin.local", presetCode: "M-01" });
    const confirmed = await saveBillDraft(draft.id, ownerUid, { expectedRevision: draft.revision, markReviewConfirmed: true });
    const finalized = await finalizeBillOnServer({ billId: draft.id, ownerUid, expectedRevision: confirmed.revision });
    const share = await publishBillShareLink({ billId: draft.id, ownerUid, expectedRevision: finalized.bill.revision });
    expect(await resolvePublicShareToken(share.shareToken)).not.toBeNull();

    vi.stubEnv("SHARE_LINKS_ENABLED", "false");
    try {
      expect(await resolvePublicShareToken(share.shareToken)).toBeNull();
      await expect(publishBillShareLink({ billId: draft.id, ownerUid, expectedRevision: share.bill.revision })).rejects.toMatchObject({ code: "SHARE_LINKS_DISABLED" });

      vi.stubEnv("SHARE_LINKS_ENABLED", "true");
      expect(await resolvePublicShareToken(share.shareToken)).not.toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rejects public links in production before accessing an unconfigured database when sharing is disabled", async () => {
    const token = signShareToken(generateRandomShareId());
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SHARE_LINKS_ENABLED", "false");
    try {
      await expect(resolvePublicShareToken(token)).resolves.toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("expires links exactly seven days after creation and allows creating a replacement", async () => {
    vi.useFakeTimers();
    const createdAt = Date.parse("2026-11-01T04:00:00Z");
    vi.setSystemTime(createdAt);
    try {
      const ownerUid = "dev-uid-host-patungin-local";
      const draft = await createDraftBill({ ownerUid, ownerVerifiedEmail: "host@patungin.local", presetCode: "M-01" });
      const confirmed = await saveBillDraft(draft.id, ownerUid, { expectedRevision: draft.revision, markReviewConfirmed: true });
      const finalized = await finalizeBillOnServer({ billId: draft.id, ownerUid, expectedRevision: confirmed.revision });
      await expect(publishBillShareLink({ billId: draft.id, ownerUid, expectedRevision: finalized.bill.revision + 1 })).rejects.toMatchObject({ code: "STALE_REVISION" });
      const share = await publishBillShareLink({ billId: draft.id, ownerUid, expectedRevision: finalized.bill.revision });
      const sameShare = await publishBillShareLink({ billId: draft.id, ownerUid, expectedRevision: share.bill.revision });
      expect(sameShare.shareToken).toBe(share.shareToken);
      expect(sameShare.bill.revision).toBe(share.bill.revision);
      const expiresAt = createdAt + 7 * 24 * 60 * 60 * 1000;
      expect(Date.parse(share.shareRecord.expiresAt)).toBe(expiresAt);
      vi.setSystemTime(expiresAt - 1);
      expect(await resolvePublicShareToken(share.shareToken)).not.toBeNull();
      vi.setSystemTime(expiresAt);
      expect(await resolvePublicShareToken(share.shareToken)).toBeNull();
      const renewed = await publishBillShareLink({ billId: draft.id, ownerUid, expectedRevision: share.bill.revision });
      expect(renewed.shareToken).not.toBe(share.shareToken);
      expect(await resolvePublicShareToken(renewed.shareToken)).not.toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it("tanggal default struk mengikuti zona aplikasi, bukan tanggal UTC server", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T17:30:00Z"));
    try {
      expect(getCurrentDateKeyInTimezone("Asia/Singapore")).toBe("2026-11-01");
      expect(getCurrentDateKeyInTimezone("UTC")).toBe("2026-10-31");
      const draft = await createDraftBill({
        ownerUid: "dev-uid-host-patungin-local",
        ownerVerifiedEmail: "host@patungin.local",
      });
      expect(draft.receiptDate).toBe("2026-11-01");
    } finally {
      vi.useRealTimers();
    }
  });

  it("SEC-T02 / SEC-T04: Allowlist email bersifat exact match (trim + lowercase) dan menolak daftar kosong", () => {
    const emptySet = parseAllowedEmails("");
    expect(emptySet.size).toBe(0);

    const list = parseAllowedEmails("  Host@Example.com , teman@domain.id ");
    expect(list.has("host@example.com")).toBe(true);
    expect(list.has("teman@domain.id")).toBe(true);
    expect(list.has("host+alias@example.com")).toBe(false);
    expect(list.has("attacker@example.com")).toBe(false);
  });

  it("SHARE-01: Token share HMAC-SHA-256 menolak manipulasi karakter dan format tidak valid", () => {
    const shareId = generateRandomShareId();
    const signed = signShareToken(shareId);

    expect(verifyShareTokenSignature(signed)).toBe(shareId);
    expect(shareId).toHaveLength(22);
    expect(signed).toHaveLength(42);
    expect(signed.startsWith("v2.")).toBe(true);
    const altered = signed.slice(0, -1) + (signed.endsWith("A") ? "B" : "A");
    expect(verifyShareTokenSignature(altered)).toBeNull();
    const oldId = crypto.randomBytes(32).toString("base64url");
    const oldPayload = `v1.${oldId}`;
    const oldSig = crypto.createHmac("sha256", process.env.SHARE_SIGNING_SECRET!).update(oldPayload).digest("base64url");
    expect(verifyShareTokenSignature(`${oldPayload}.${oldSig}`)).toBeNull();
    expect(() => signShareToken(oldId)).toThrow();
    expect(verifyShareTokenSignature(`${signed}x`)).toBeNull();
    expect(verifyShareTokenSignature("v1.palsu.signature")).toBeNull();
    expect(verifyShareTokenSignature("")).toBeNull();
  });

  it("SCAN-01: Validasi gambar menerima JPEG nyata dan menolak HEIC atau file palsu", async () => {
    const jpeg = await sharp({ create: { width: 16, height: 16, channels: 3, background: "white" } }).jpeg().toBuffer();
    const resJpeg = await validateAndInspectImageBytes(jpeg);
    expect(resJpeg.mimeType).toBe("image/jpeg");
    expect(resJpeg.imageHash).toHaveLength(64);

    // Simulasi header HEIC (....ftypheic)
    const fakeHeic = Buffer.from("\x00\x00\x00\x18ftypheic0000", "ascii");
    await expect(validateAndInspectImageBytes(fakeHeic)).rejects.toThrow(
      /HEIC belum dapat diproses/i
    );

    // File teks menyamar jadi gambar
    const fakeText = Buffer.from("Hello world not an image", "utf8");
    await expect(validateAndInspectImageBytes(fakeText)).rejects.toThrow(
      /Format gambar tidak didukung/i
    );
  });

  it("BILL-01 & SHARE-01: Siklus penuh Draft -> Revision Conflict -> Finalize -> Share -> Reopen mencabut Share secara atomik", async () => {
    const ownerUid = "dev-uid-host-patungin-local";
    const ownerEmail = "host@patungin.local";

    const draft = await createDraftBill({
      ownerUid,
      ownerVerifiedEmail: ownerEmail,
      title: "Uji Integrasi Siklus",
      presetCode: "M-01",
    });

    expect(draft.revision).toBe(1);

    // Ownership check: UID asing wajib ditolak 403
    await expect(
      saveBillDraft(draft.id, "uid-orang-asing", {
        expectedRevision: 1,
        title: "Bajak",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN_BILL_ACCESS", statusCode: 403 });

    // Simpan perubahan dengan revision yang benar (1 -> 2)
    const updated = await saveBillDraft(draft.id, ownerUid, {
      expectedRevision: 1,
      title: "Makan Siang Terkonfirmasi",
      markReviewConfirmed: true,
    });
    expect(updated.revision).toBe(2);

    // Simpan dengan revision basi (expectedRevision: 1 padahal sudah 2) wajib ditolak 409
    await expect(
      saveBillDraft(draft.id, ownerUid, {
        expectedRevision: 1,
        title: "Tab Lama",
      })
    ).rejects.toThrow(/berubah di tab/i);

    // Finalisasi di server
    const { bill: finalizedBill, snapshot } = await finalizeBillOnServer({
      billId: draft.id,
      ownerUid,
      expectedRevision: 2,
    });
    expect(finalizedBill.status).toBe("finalized");
    expect(snapshot.calculationResult.computedGrandTotal).toBe(115_500);

    // Buat share link
    const { shareToken } = await publishBillShareLink({
      billId: draft.id,
      ownerUid,
      expectedRevision: finalizedBill.revision,
    });

    // Pastikan link publik bisa dibaca dan tidak membocorkan ownerEmail/ownerUid
    const publicView = await resolvePublicShareToken(shareToken);
    expect(publicView).not.toBeNull();
    expect(publicView?.grandTotal).toBe(115_500);
    expect(JSON.stringify(publicView)).not.toContain(ownerEmail);

    // Reopen tagihan ke draft -> link lama wajib otomatis tercabut secara atomik!
    const reopened = await reopenBillToDraft({
      billId: draft.id,
      ownerUid,
      expectedRevision: finalizedBill.revision + 1,
    });
    expect(reopened.status).toBe("draft");
    expect(reopened.activeShareId).toBeNull();

    const afterReopenView = await resolvePublicShareToken(shareToken);
    expect(afterReopenView).toBeNull();
  });
});

