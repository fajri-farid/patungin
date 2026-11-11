"use client";

import { processReceiptImageOnClient } from "@/lib/receipt-image-client";
import { requestJson, RequestInterruptedError } from "@/lib/request-json";
import { SlowOperationNotice } from "@/components/SlowOperationNotice";
import {
  loadReceiptState,
  uploadReceiptFile,
} from "@/lib/receipt-photo-client";
import {
  rememberReceiptPreview,
  forgetReceiptPreview,
} from "@/lib/local-receipt-preview";
import React, { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  FilePenLine,
  ImagePlus,
  Loader2,
  RotateCw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { AppHeader } from "@/components/product/AppHeader";
import { ReceiptImageSkeleton } from "@/components/product/ProductLoading";
import ui from "@/components/product/product.module.css";
import { createBillAction } from "@/app/actions/bills";

class ReceiptInputError extends Error {}

export interface ScanQuotaStatus {
  scanEnabled: boolean;
  usedThisMonth: number;
  monthlyLimit: number;
  bonus: number;
  remaining: number;
}

interface NewBillClientProps {
  embedded?: boolean;
  quotaStatus: ScanQuotaStatus;
  receiptsEnabled?: boolean;
}

type ProcessingPhase = "manual" | "optimize" | "upload" | "scan" | null;

export function NewBillClient({
  quotaStatus,
  embedded = false,
  receiptsEnabled = false,
}: NewBillClientProps) {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const photoKeyRef = useRef(crypto.randomUUID());

  const [photo, setPhoto] = useState<string | null>(null);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [stage, setStage] = useState<string | null>(null);
  const [phase, setPhase] = useState<ProcessingPhase>(null);
  const [uploadSkipped, setUploadSkipped] = useState(false);
  const [scanNeedsReview, setScanNeedsReview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdBill, setCreatedBill] = useState<{
    id: string;
    revision: number;
  } | null>(null);

  const remaining = quotaStatus.remaining;
  const canScan = quotaStatus.scanEnabled && remaining > 0 && !scanNeedsReview;
  const totalQuota = quotaStatus.monthlyLimit + quotaStatus.bonus;
  const usedQuota =
    typeof quotaStatus.usedThisMonth === "number"
      ? quotaStatus.usedThisMonth
      : Math.max(0, totalQuota - remaining);
  const quotaPercent =
    totalQuota > 0
      ? Math.min(100, Math.max(0, Math.round((remaining / totalQuota) * 100)))
      : 0;
  const isQuotaLow = remaining > 0 && remaining <= 5;
  const isQuotaDepleted = remaining === 0;
  const Heading = embedded ? "h1" : "h2";

  const handleFile = (file: File | undefined) => {
    if (!file || busyRef.current || isReadingFile) return;
    setError(null);
    if (/\.hei[cf]$/i.test(file.name)) {
      setError(
        "Foto HEIC belum bisa dibaca. Pilih foto dalam format JPG, PNG, atau WebP.",
      );
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("Foto terlalu besar. Pilih foto berukuran maksimal 8 MB.");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Pilih gambar JPG, PNG, atau WebP.");
      return;
    }
    setIsReadingFile(true);
    const reader = new FileReader();
    reader.onload = () => {
      setIsReadingFile(false);
      if (typeof reader.result === "string") {
        photoKeyRef.current = crypto.randomUUID();
        setPhoto(reader.result);
        setRotation(0);
      }
    };
    reader.onerror = () => {
      setIsReadingFile(false);
      setError("Foto belum bisa dibuka. Pilih foto lagi.");
    };
    reader.readAsDataURL(file);
  };

  const selectFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    handleFile(file);
  };

  const start = async (manual = false) => {
    if (busyRef.current || (!manual && (!photo || !canScan))) return;
    busyRef.current = true;
    setError(null);
    setUploadSkipped(false);
    let photoNotSaved = false;
    try {
      if (manual) {
        setPhase("manual");
        setStage("Menyiapkan tagihan…");
      } else {
        setPhase("optimize");
        setStage("Menyiapkan foto…");
      }

      const processed =
        !manual && photo
          ? await processReceiptImageOnClient({
              dataUrl: photo,
              rotationDeg: rotation,
              cropVerticalMarginPct: 0,
            })
          : null;
      if (processed && processed.blob.size > 2 * 1024 * 1024)
        throw new ReceiptInputError(
          "Foto masih terlalu besar. Potong area di luar struk pada foto, lalu pilih lagi.",
        );
      let draft = createdBill;
      if (!draft) {
        const result = await createBillAction({ title: "Tagihan baru" });
        if (!result.ok || !result.data)
          throw new ReceiptInputError(
            result.error ?? "Tagihan belum bisa dibuat. Coba lagi.",
          );
        draft = { id: result.data.id, revision: result.data.revision };
        setCreatedBill(draft);
      }
      if (processed) {
        rememberReceiptPreview(draft.id, processed.previewDataUrl);
        if (receiptsEnabled) {
          setPhase("upload");
          setStage("Menyimpan foto…");
          try {
            const saved = await uploadReceiptFile(
              draft,
              processed.blob,
              `${photoKeyRef.current}_${rotation}`,
            );
            draft = { id: saved.bill.id, revision: saved.bill.revision };
            setCreatedBill(draft);
            forgetReceiptPreview(draft.id);
          } catch {
            photoNotSaved = true;
            setUploadSkipped(true);
            // Do not issue OCR against an uncertain revision after a lost upload response.
            const state = await loadReceiptState(draft.id);
            if (state.bill.receiptPhotoUploadId)
              throw new ReceiptInputError(
                "Foto masih diproses. Tunggu sebentar lalu coba lagi; scan belum dijalankan.",
              );
            draft = { id: state.bill.id, revision: state.bill.revision };
            setCreatedBill(draft);
            photoNotSaved = state.photo.status !== "available";
          }
        }
        setPhase("scan");
        setStage("Membaca pesanan dan harga…");
        const form = new FormData();
        form.append(
          "receipt",
          new File([processed.blob], "receipt.jpg", { type: "image/jpeg" }),
        );
        form.append(
          "idempotencyKey",
          `scan_${draft.id}_${crypto.randomUUID()}`,
        );
        form.append("expectedRevision", String(draft.revision));
        let scanResponse;
        try {
          scanResponse = await requestJson(`/api/bills/${draft.id}/scan`, {
          method: "POST",
          body: form,
          });
        } catch {
          // A lost response does not mean OCR failed. Do not spend quota on another attempt.
          setScanNeedsReview(true);
          throw new ReceiptInputError(
            "Hasil scan belum muncul. Buka tagihan untuk mengeceknya sebelum scan lagi.",
          );
        }
        const { response, result: data } = scanResponse;
        if (!response.ok || !data.ok)
          throw new ReceiptInputError(
            data.error ??
              "Struk belum terbaca. Coba lagi atau lanjut isi manual.",
          );
      }
      router.push(
        `/bills/${draft.id}/review${photoNotSaved ? "?photo=not-saved" : ""}`,
      );
    } catch (err) {
      setError(
        err instanceof ReceiptInputError || err instanceof RequestInterruptedError
          ? err.message
          : "Belum bisa melanjutkan. Periksa koneksi lalu coba lagi.",
      );
      setStage(null);
      setPhase(null);
      busyRef.current = false;
      router.refresh();
    }
  };

  const isProcessingPhoto =
    phase === "optimize" || phase === "upload" || phase === "scan";

  const content = (
    <section
      aria-labelledby="new-bill-heading"
      className={`${ui.panel} space-y-4`}
    >
      <p role="status" className="sr-only">
        {stage}
      </p>
      {stage && <SlowOperationNotice />}
      <div className="flex items-start justify-between gap-3">
        <div>
          <Heading id="new-bill-heading" className={ui.sectionTitle}>
            Masukkan struk
          </Heading>
          <p className={`${ui.muted} mt-1`}>
            Foto struk atau pilih screenshot pesanan. Cek hasilnya sebelum
            dibagi.
          </p>
        </div>
      </div>

      {/* Kartu Status Kuota Scan */}
      <div
        className="rounded-2xl border border-[#D8E2F2] bg-gradient-to-b from-[#F9FBFF] to-[#F3F7FD] p-4 transition-colors"
        role="region"
        aria-label="Informasi Kuota Scan Struk"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                isQuotaDepleted
                  ? "bg-[#FDECEC] text-[#B42318]"
                  : isQuotaLow
                    ? "bg-[#FFF3E6] text-[#9A4A12]"
                    : "bg-[#E6EDFF] text-[#2855D9]"
              }`}
            >
              <Sparkles size={15} aria-hidden="true" />
            </span>
            <span className="text-xs font-bold uppercase tracking-wider text-[#4A5B7C]">
              Kuota scan bulan ini
            </span>
          </div>

          <div>
            {!quotaStatus.scanEnabled ? (
              <span className="inline-flex items-center rounded-full border border-gray-300 bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
                Nonaktif
              </span>
            ) : isQuotaDepleted ? (
              <span className="inline-flex items-center rounded-full border border-[#FCD2D2] bg-[#FDECEC] px-2.5 py-0.5 text-xs font-semibold text-[#B42318]">
                Habis
              </span>
            ) : isQuotaLow ? (
              <span className="inline-flex items-center rounded-full border border-[#FFE0BD] bg-[#FFF3E6] px-2.5 py-0.5 text-xs font-semibold text-[#9A4A12]">
                Sisa sedikit
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#BEE7D5] bg-[#E6F5EF] px-2.5 py-0.5 text-xs font-semibold text-[#146346]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#146346] animate-pulse" />
                Aktif
              </span>
            )}
          </div>
        </div>

        <div className="mt-3 flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-[#17233B] tabular-nums">
              {remaining}
            </span>
            <span className="text-xs sm:text-sm font-medium text-[#7687A6]">
              / {totalQuota} scan tersisa
            </span>
          </div>
          {quotaStatus.bonus > 0 && (
            <span className="inline-flex items-center rounded-full border border-[#C9DAFC] bg-[#E6EDFF] px-2 py-0.5 text-[11px] font-bold text-[#2855D9]">
              +{quotaStatus.bonus} bonus
            </span>
          )}
        </div>

        <div
          className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-[#E2E8F0]"
          role="progressbar"
          aria-valuenow={remaining}
          aria-valuemin={0}
          aria-valuemax={totalQuota}
          aria-label={`Sisa ${remaining} dari ${totalQuota} scan bulan ini`}
        >
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${
              isQuotaDepleted
                ? "bg-[#B42318] w-0"
                : isQuotaLow
                  ? "bg-[#D97706]"
                  : "bg-[#2855D9]"
            }`}
            style={{ width: `${quotaPercent}%` }}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-[#7687A6]">
          <div className="flex items-center gap-1.5">
            <Clock
              size={13}
              className="text-[#4A5B7C] shrink-0"
              aria-hidden="true"
            />
            <span>
              Diperbarui tiap tanggal <strong>1, 00.00 WITA</strong>
            </span>
          </div>
          <div>
            {isQuotaDepleted ? (
              <span className="font-semibold text-[#B42318]">
                Isi manual tanpa kuota
              </span>
            ) : isQuotaLow ? (
              <span className="font-medium text-[#9A4A12]">
                Sisa {remaining} scan lagi
              </span>
            ) : (
              <span className="text-[#4A5B7C]">{usedQuota} scan terpakai</span>
            )}
          </div>
        </div>

        {!canScan && (
          <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-[#FFE0BD] bg-[#FFF3E6] p-3 text-xs leading-relaxed text-[#9A4A12]">
            <AlertTriangle
              size={16}
              className="mt-0.5 shrink-0 text-[#D97706]"
              aria-hidden="true"
            />
            <div>
              <strong>
                {quotaStatus.scanEnabled
                  ? "Kuota scan bulan ini sudah habis."
                  : "Fitur baca struk sedang tidak tersedia."}
              </strong>{" "}
              Kamu tetap bisa membuat tagihan dengan memilih{" "}
              <span className="font-bold underline">Isi manual</span> di bawah.
            </div>
          </div>
        )}
      </div>

      <input
        ref={cameraRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        onChange={selectFile}
        className="hidden"
        aria-label="Ambil foto struk"
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={selectFile}
        className="hidden"
        aria-label="Pilih foto struk"
      />

      {error && (
        <div role="alert" className={`${ui.error} flex items-start gap-2.5`}>
          <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center gap-2 rounded-xl bg-[#F4F7FC] border border-[#E2EAF6] px-3 py-2 text-xs text-[#4A5B7C]">
        <ShieldCheck size={15} className="shrink-0 text-[#2855D9]" aria-hidden="true" />
        <span>
          {receiptsEnabled
            ? "Foto bisa dibuka selama 24 jam. Hanya dibagikan jika kamu memilih."
            : "Foto dipakai untuk membaca struk, tetapi belum bisa disimpan."}
        </span>
      </div>

      {isReadingFile ? (
        <ReceiptImageSkeleton label="Membuka foto dari perangkat…" />
      ) : photo ? (
        <div className="space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold text-[#17233B]">
              Pastikan nama pesanan dan total akhir terlihat jelas
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={!!stage}
                onClick={() => setRotation((value) => (value + 90) % 360)}
                className={`${ui.secondary} !min-h-11 !px-3 !py-1.5 !text-xs`}
              >
                <RotateCw size={15} aria-hidden="true" />
                Putar
              </button>
              <button
                type="button"
                disabled={!!stage}
                onClick={() => galleryRef.current?.click()}
                className={`${ui.secondary} !min-h-11 !px-3 !py-1.5 !text-xs`}
              >
                Ganti foto
              </button>
              <button
                type="button"
                disabled={!!stage}
                onClick={() => setPhoto(null)}
                aria-label="Hapus foto terpilih"
                className={ui.iconButton}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Preview Frame + Live Scanning Animation */}
          <div
            className={`${ui.scanViewport} flex h-72 items-center justify-center rounded-2xl border border-[#D8E2F2] bg-[#EEF3FB] p-4`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo}
              alt="Foto struk yang akan dibaca"
              style={{ transform: `rotate(${rotation}deg)` }}
              className="max-h-60 max-w-full rounded-lg object-contain shadow-xs transition-transform duration-200"
            />

            {isProcessingPhoto && (
              <div className={ui.scanOverlay} aria-hidden="true">
                <div className={ui.scanFrame} />
                <div className={ui.scanBeam} />
                <span className="relative z-10 inline-flex items-center gap-2 rounded-full border border-white/40 bg-[#17233B]/85 px-4 py-2 text-xs font-bold text-white shadow-md">
                  <Loader2 size={14} className={ui.spinner} />
                  {stage}
                </span>
              </div>
            )}
          </div>

          {/* Real Multi-Stage Progress Tracker while processing */}
          {isProcessingPhoto && (
            <div
              role="region"
              aria-label="Tahap pemrosesan struk"
              className="rounded-2xl border border-[#9DC0FB] bg-gradient-to-b from-[#F4F8FF] to-white p-3.5 space-y-3"
            >
              <div className={ui.indeterminateTrack} aria-hidden="true">
                <div className={ui.indeterminateBar} />
              </div>
              <ol className="space-y-2 text-xs">
                <li className="flex items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center gap-2 font-bold ${
                      phase === "optimize"
                        ? "text-[#2855D9]"
                        : "text-[#146346]"
                    }`}
                  >
                    {phase === "optimize" ? (
                      <Loader2 size={14} className={ui.spinner} aria-hidden="true" />
                    ) : (
                      <CheckCircle2 size={14} aria-hidden="true" />
                    )}
                    1. Siapkan foto
                  </span>
                  <span className="text-[#7687A6]">
                    {phase === "optimize" ? "Berjalan" : "Selesai"}
                  </span>
                </li>

                {receiptsEnabled && (
                  <li className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center gap-2 font-bold ${
                        phase === "upload"
                          ? "text-[#2855D9]"
                          : phase === "scan"
                            ? uploadSkipped
                              ? "text-[#9A4A12]"
                              : "text-[#146346]"
                            : "text-[#7687A6]"
                      }`}
                    >
                      {phase === "upload" ? (
                        <Loader2 size={14} className={ui.spinner} aria-hidden="true" />
                      ) : phase === "scan" ? (
                        uploadSkipped ? (
                          <AlertTriangle size={14} aria-hidden="true" />
                        ) : (
                          <CheckCircle2 size={14} aria-hidden="true" />
                        )
                      ) : (
                        <span className="inline-block h-3.5 w-3.5 rounded-full border border-[#CBD5E1]" />
                      )}
                      2. Simpan foto
                    </span>
                    <span className="text-[#7687A6]">
                      {phase === "upload"
                        ? "Menyimpan"
                        : phase === "scan"
                          ? uploadSkipped
                            ? "Belum tersimpan"
                            : "Tersimpan"
                          : "Menunggu"}
                    </span>
                  </li>
                )}

                <li className="flex items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center gap-2 font-bold ${
                      phase === "scan" ? "text-[#2855D9]" : "text-[#7687A6]"
                    }`}
                  >
                    {phase === "scan" ? (
                      <Loader2 size={14} className={ui.spinner} aria-hidden="true" />
                    ) : (
                      <span className="inline-block h-3.5 w-3.5 rounded-full border border-[#CBD5E1]" />
                    )}
                    {receiptsEnabled ? "3." : "2."} Baca struk
                  </span>
                  <span className="text-[#7687A6]">
                    {phase === "scan" ? "Membaca" : "Menunggu"}
                  </span>
                </li>
              </ol>
            </div>
          )}

          <button
            type="button"
            onClick={() => start()}
            disabled={!!stage || !canScan}
            className={`${ui.primary} w-full`}
            aria-busy={isProcessingPhoto}
          >
            {isProcessingPhoto ? (
              <Loader2 size={18} className={ui.spinner} aria-hidden="true" />
            ) : (
              <ScanLine size={18} aria-hidden="true" />
            )}
            {isProcessingPhoto ? stage : "Baca struk"}
          </button>

          <button
            type="button"
            onClick={() => start(true)}
            disabled={!!stage}
            className={`${ui.secondary} w-full`}
            aria-busy={phase === "manual"}
          >
            {phase === "manual" && (
              <Loader2 size={17} className={ui.spinner} aria-hidden="true" />
            )}
            {phase === "manual" ? "Menyiapkan tagihan…" : scanNeedsReview ? "Buka tagihan" : "Isi manual"}
          </button>

          <details className="rounded-xl border border-[#E2EAF6] bg-[#F8FAFF] px-3.5 py-2 text-xs text-[#4A5B7C]">
            <summary className="flex min-h-10 cursor-pointer items-center font-bold text-[#17233B]">
              Bagaimana foto digunakan?
            </summary>
            <p className="pb-1.5 pt-1 leading-relaxed">
              Foto dikirim ke Google Gemini untuk membaca pesanan dan harga.
              {receiptsEnabled
                ? " Hanya kamu yang bisa melihat foto, kecuali kamu memilih membagikannya. Foto bisa dibuka selama 24 jam sejak disimpan, lalu akan dihapus otomatis."
                : " Foto belum bisa disimpan. Kamu hanya bisa melihatnya sementara di tab ini."}
            </p>
          </details>
        </div>
      ) : (
        <div
          onDragOver={(event) => {
            if (!canScan || !!stage) return;
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            if (!canScan || !!stage) return;
            handleFile(event.dataTransfer.files?.[0]);
          }}
          className={`space-y-4 rounded-2xl transition-colors ${
            isDragging
              ? "ring-2 ring-[#2855D9] ring-offset-4 bg-[#EEF4FF]/60 p-2"
              : ""
          }`}
        >
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              disabled={!!stage || !canScan}
              className="group flex min-h-28 flex-col items-center justify-center gap-1.5 rounded-2xl bg-[#2855D9] p-3.5 text-center text-white shadow-xs hover:bg-[#1E44B8] disabled:opacity-40 cursor-pointer"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15">
                <Camera size={24} aria-hidden="true" />
              </span>
              <span className="text-sm font-extrabold">Foto struk</span>
              <span className="text-[11px] font-medium text-white/85">
                Buka kamera
              </span>
            </button>

            <button
              type="button"
              onClick={() => galleryRef.current?.click()}
              disabled={!!stage || !canScan}
              className="group flex min-h-28 flex-col items-center justify-center gap-1.5 rounded-2xl border border-[#B4CCFA] bg-[#EEF4FF] p-3.5 text-center text-[#1E44B8] hover:bg-[#E1ECFF] disabled:opacity-40 cursor-pointer"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-[#2855D9] border border-[#D4E2FC]">
                <ImagePlus size={24} aria-hidden="true" />
              </span>
              <span className="text-sm font-extrabold">Pilih dari galeri</span>
              <span className="text-[11px] font-medium text-[#4A5B7C]">
                JPG, PNG, WebP
              </span>
            </button>
          </div>

          <div className="pt-3 border-t border-[#D8E2F2]">
            <button
              type="button"
              onClick={() => start(true)}
              disabled={!!stage}
              className={`${canScan ? ui.secondary : ui.primary} w-full`}
              aria-busy={phase === "manual"}
            >
              {phase === "manual" ? (
                <Loader2 size={18} className={ui.spinner} aria-hidden="true" />
              ) : (
                <FilePenLine size={18} aria-hidden="true" />
              )}
              {phase === "manual" ? "Menyiapkan tagihan…" : "Isi manual"}
            </button>
            <p className="mt-2 text-center text-xs text-[#4A5B7C]">
              Tanpa foto struk? Ketik nama pesanan dan harganya langsung.
            </p>
          </div>
        </div>
      )}
    </section>
  );

  if (embedded) return content;
  return (
    <div className={ui.page}>
      <AppHeader />
      <main className={ui.main}>
        <div className={ui.intro}>
          <h1>Buat tagihan baru.</h1>
          <p>Mulai dari foto struk atau isi pesanan sendiri.</p>
        </div>
        {content}
      </main>
    </div>
  );
}
