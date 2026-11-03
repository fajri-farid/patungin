import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  AuthGuardError,
  requireSessionIdentity,
  requireAuthenticatedHost,
  verifyRequestOrigin,
} from "@/server/auth/session";
import { getServerConfig } from "@/server/config/env";
import {
  extractReceiptWithGemini,
  PROMPT_VERSION,
  MAX_SERVER_IMAGE_BYTES,
  validateAndInspectImageBytes,
} from "@/server/scans/gemini";
import {
  AppServiceError,
  completeScanAttempt,
  reserveScanAttempt,
  type ExtractedReceiptSuggestion,
} from "@/server/store/repository";
import {
  recordOperationalEvent,
  serverDiagnostic,
  type EventStage,
} from "@/server/observability/events";
import { DIAGNOSTICS } from "@/domain/diagnostics";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  let ownerUid: string | undefined;
  let billId: string | undefined;
  let attemptId: string | undefined;
  let stage: EventStage = "validation";
  let quotaReserved: boolean | null = false;
  let providerCalled: boolean | null = false;
  let resultRecorded = false;
  const reply = (data: object, status = 200) =>
    NextResponse.json(
      { ...data, requestId },
      { status, headers: { "X-Request-Id": requestId } },
    );
  try {
    await verifyRequestOrigin(request);
    const identity = await requireSessionIdentity();
    ownerUid = identity.uid;
    await requireAuthenticatedHost();
    billId = (await context.params).id;
    if (!billId || billId.includes("/") || billId.length > 128)
      throw new AppServiceError(400, "BILL_NOT_FOUND", "Tagihan tidak valid.");

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      throw new AppServiceError(
        400,
        "INVALID_FORM",
        "Data unggahan tidak valid.",
      );
    }
    const fileEntry = formData.get("receipt");
    const idempotencyKey = (
      formData.get("idempotencyKey")?.toString() ?? ""
    ).trim();
    const revisionRaw = formData.get("expectedRevision")?.toString();
    const expectedRevision = revisionRaw ? Number(revisionRaw) : 1;
    if (
      !idempotencyKey ||
      idempotencyKey.length < 8 ||
      idempotencyKey.length > 256
    )
      throw new AppServiceError(
        400,
        "MISSING_IDEMPOTENCY_KEY",
        "Identitas permintaan tidak valid.",
      );
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
      throw new AppServiceError(
        400,
        "INVALID_REVISION",
        "Revisi draft tidak valid.",
      );
    if (!(fileEntry instanceof File))
      throw new AppServiceError(
        400,
        "MISSING_FILE",
        "Pilih atau ambil foto struk terlebih dahulu.",
      );
    if (fileEntry.size > MAX_SERVER_IMAGE_BYTES)
      throw new AppServiceError(
        422,
        "IMAGE_TOO_LARGE",
        "Ukuran gambar melebihi batas 2 MiB setelah optimasi. Pilih foto lain atau potong bagian penting.",
      );

    const imageBuffer = Buffer.from(await fileEntry.arrayBuffer());
    const { mimeType, imageHash } = validateAndInspectImageBytes(imageBuffer);
    const config = getServerConfig();
    stage = "quota";
    // A transport failure can leave commit status uncertain.
    quotaReserved = null;
    const { attempt, isDuplicate } = await reserveScanAttempt({
      ownerUid,
      billId,
      expectedRevision,
      idempotencyKey,
      imageHash,
      model: config.gemini.model,
      promptVersion: PROMPT_VERSION,
      requestId,
    });
    attemptId = attempt.id;
    if (isDuplicate) {
      await recordOperationalEvent({
        ownerUid,
        code: "DUPLICATE_REQUEST",
        stage,
        requestId,
        billId,
        attemptId,
        quotaReserved: false,
        providerCalled: false,
      });
      return reply({
        ok: attempt.state === "succeeded",
        isDuplicate: true,
        attempt,
      });
    }
    quotaReserved = true;
    stage = "provider";
    providerCalled = config.gemini.isConfigured;
    let extracted: ExtractedReceiptSuggestion;
    try {
      extracted = await extractReceiptWithGemini({ imageBuffer, mimeType });
    } catch (error) {
      const code =
        error instanceof AppServiceError &&
        Object.hasOwn(DIAGNOSTICS, error.code)
          ? error.code
          : "PROVIDER_ERROR";
      const message =
        error instanceof AppServiceError
          ? error.message
          : "Pembacaan mengalami gangguan.";
      stage = "persistence";
      try {
        await completeScanAttempt({
          attemptId,
          state: code === "PROVIDER_TIMEOUT" ? "unknown" : "failed",
          errorCode: code,
          errorMessage: message,
          applyToBillIfRevisionMatches: false,
        });
      } catch {
        throw new AppServiceError(
          503,
          "PERSISTENCE_FAILED",
          "Status hasil scan belum dapat disimpan. Periksa draft sebelum mencoba lagi.",
        );
      }
      resultRecorded = true;
      serverDiagnostic({
        code,
        stage: "provider",
        requestId,
        ownerUid,
        attemptId,
      });
      throw error instanceof AppServiceError
        ? error
        : new AppServiceError(
            503,
            "PROVIDER_ERROR",
            "Pembacaan mengalami gangguan. Anda dapat mengisi secara manual.",
          );
    }

    // Saving a successful provider result is a separate failure stage.
    stage = "persistence";
    let completion: Awaited<ReturnType<typeof completeScanAttempt>>;
    try {
      completion = await completeScanAttempt({
        attemptId,
        state: "succeeded",
        extractedData: extracted,
        applyToBillIfRevisionMatches: true,
      });
    } catch {
      throw new AppServiceError(
        503,
        "PERSISTENCE_FAILED",
        "Hasil scan belum dapat disimpan. Periksa draft sebelum mencoba lagi.",
      );
    }
    return reply({
      ok: true,
      isDuplicate: false,
      attempt: completion.attempt,
      appliedToBill: completion.appliedToBill,
      updatedBill: completion.updatedBill,
    });
  } catch (error) {
    const known =
      error instanceof AppServiceError || error instanceof AuthGuardError;
    const code = known
      ? error.code
      : stage === "quota"
        ? "DATABASE_FAILED"
        : "UNEXPECTED_ERROR";
    // Explicit service rejections happen before quota reservation.
    if (stage === "quota" && error instanceof AppServiceError)
      quotaReserved = false;
    if (!resultRecorded && ownerUid) {
      await recordOperationalEvent({
        ownerUid,
        code,
        stage,
        requestId,
        billId,
        attemptId,
        quotaReserved,
        providerCalled,
      });
    } else if (!ownerUid && !(error instanceof AuthGuardError)) {
      // Anonymous failures never create Firestore documents.
      serverDiagnostic({ code, stage, requestId });
    }
    return reply(
      {
        code: known ? error.code : "INTERNAL_SCAN_ERROR",
        error: known
          ? error.message
          : "Terjadi gangguan saat membaca struk. Periksa draft atau lanjutkan secara manual.",
      },
      known ? error.statusCode : 500,
    );
  }
}
