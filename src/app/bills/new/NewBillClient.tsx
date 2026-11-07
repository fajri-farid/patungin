"use client";

import { processReceiptImageOnClient } from "@/lib/receipt-image-client";
import { loadReceiptState, uploadReceiptFile } from "@/lib/receipt-photo-client";
import { rememberReceiptPreview, forgetReceiptPreview } from "@/lib/local-receipt-preview";
import React, { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Camera,
  Clock,
  FilePenLine,
  ImagePlus,
  Loader2,
  RotateCw,
  ScanLine,
  Sparkles,
  X,
} from "lucide-react";
import { AppHeader } from "@/components/product/AppHeader";
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
interface NewBillClientProps { embedded?: boolean; quotaStatus: ScanQuotaStatus; receiptsEnabled?: boolean }


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
  const [rotation, setRotation] = useState(0);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdBill, setCreatedBill] = useState<{
    id: string;
    revision: number;
  } | null>(null);
  const remaining = quotaStatus.remaining;
  const canScan = quotaStatus.scanEnabled && remaining > 0;
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

  const selectFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busyRef.current) return;
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
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        photoKeyRef.current = crypto.randomUUID();
        setPhoto(reader.result);
        setRotation(0);
      }
    };
    reader.onerror = () => setError("Foto belum bisa dibuka. Pilih foto lagi.");
    reader.readAsDataURL(file);
  };

  const start = async (manual = false) => {
    if (busyRef.current || (!manual && (!photo || !canScan))) return;
    busyRef.current = true;
    setError(null);
    let photoNotSaved = false;
    try {
      setStage(manual ? "Menyiapkan tagihan…" : "Menyiapkan foto…");
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
          setStage("Menyimpan foto selama 24 jam…");
          try {
            const saved = await uploadReceiptFile(draft, processed.blob, `${photoKeyRef.current}_${rotation}`);
            draft = { id: saved.bill.id, revision: saved.bill.revision };
            setCreatedBill(draft);
            forgetReceiptPreview(draft.id);
          } catch {
            photoNotSaved = true;
            // Do not issue OCR against an uncertain revision after a lost upload response.
            const state = await loadReceiptState(draft.id);
            if (state.bill.receiptPhotoUploadId) throw new ReceiptInputError("Foto masih diproses. Tunggu sebentar lalu coba lagi; scan belum dijalankan.");
            draft = { id: state.bill.id, revision: state.bill.revision };
            setCreatedBill(draft);
            photoNotSaved = state.photo.status !== "available";
          }
        }
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
        const response = await fetch(`/api/bills/${draft.id}/scan`, {
          method: "POST",
          body: form,
        });
        const data = await response.json();
        if (!response.ok || !data.ok)
          throw new ReceiptInputError(
            data.error ??
              "Struk belum terbaca. Coba lagi atau lanjut isi manual.",
          );
      }
      router.push(`/bills/${draft.id}/review${photoNotSaved ? "?photo=not-saved" : ""}`);
    } catch (err) {
      setError(
        err instanceof ReceiptInputError
          ? err.message
          : "Belum bisa melanjutkan. Periksa koneksi lalu coba lagi.",
      );
      setStage(null);
      busyRef.current = false;
      router.refresh();
    }
  };

  const content = (
    <section
      aria-labelledby="new-bill-heading"
      className={`${ui.panel} space-y-4`}
    >
      <p role="status" className="sr-only">
        {stage}
      </p>
      <div>
        <Heading id="new-bill-heading" className={ui.sectionTitle}>
          Masukkan struk
        </Heading>
        <p className={`${ui.muted} mt-2`}>
          Foto struk atau pilih screenshot pesanan. Cek hasilnya sebelum dibagi.
        </p>
      </div>

      {/* Kartu Status Kuota Scan */}
      <div
        className="rounded-2xl border border-[#D8E2F2] bg-gradient-to-b from-[#F9FBFF] to-[#F3F7FD] p-4 transition-all"
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
              Kuota Bulan Ini
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
              / {totalQuota} scan
            </span>
          </div>
          {quotaStatus.bonus > 0 && (
            <span className="inline-flex items-center rounded-full border border-[#C9DAFC] bg-[#E6EDFF] px-2 py-0.5 text-[11px] font-bold text-[#2855D9]">
              +{quotaStatus.bonus} bonus
            </span>
          )}
        </div>

        {/* Bar Indikator Sisa Kuota */}
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

        {/* Detail Waktu Reset & Info Pemakaian */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-[#7687A6]">
          <div className="flex items-center gap-1.5">
            <Clock size={13} className="text-[#4A5B7C] shrink-0" aria-hidden="true" />
            <span>
              Reset tanggal <strong>1, 00.00 WITA</strong>
            </span>
          </div>
          <div>
            {isQuotaDepleted ? (
              <span className="font-semibold text-[#B42318]">
                Bebas kuota via Isi manual
              </span>
            ) : isQuotaLow ? (
              <span className="font-medium text-[#9A4A12]">
                Sisa {remaining} scan lagi
              </span>
            ) : (
              <span className="text-[#4A5B7C]">
                {usedQuota} scan terpakai
              </span>
            )}
          </div>
        </div>

        {!canScan && (
          <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-[#FFE0BD] bg-[#FFF3E6] p-3 text-xs leading-relaxed text-[#9A4A12]">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[#D97706]" aria-hidden="true" />
            <div>
              <strong>
                {quotaStatus.scanEnabled
                  ? "Kuota scan bulan ini sudah habis."
                  : "Fitur baca struk sedang tidak tersedia."}
              </strong>{" "}
              Jangan khawatir! Kamu tetap bisa membuat tagihan tanpa batas dengan opsi{" "}
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
        <div role="alert" className={`${ui.error} flex items-start gap-2`}>
          <AlertTriangle size={18} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <p className="text-xs text-[#4A5B7C]">{receiptsEnabled ? "Foto disimpan sementara selama 24 jam. Berbagi foto ke teman bisa dipilih nanti." : "Foto dipakai untuk membaca struk. Penyimpanan foto sementara belum tersedia."}</p>
      {photo ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold">
              Pastikan pesanan dan totalnya terlihat.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!!stage}
                onClick={() => setRotation((value) => (value + 90) % 360)}
                className={`${ui.secondary} !min-h-11 !px-3 !py-2 !text-sm`}
              >
                <RotateCw size={16} aria-hidden="true" />
                Putar
              </button>
              <button
                type="button"
                disabled={!!stage}
                onClick={() => galleryRef.current?.click()}
                className={`${ui.secondary} !min-h-11 !px-3 !py-2 !text-sm`}
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
          <div className="rounded-xl bg-[#F4F7FC] border border-[#D8E2F2] overflow-hidden flex items-center justify-center p-4 h-72">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo}
              alt="Foto struk yang akan dibaca"
              style={{ transform: `rotate(${rotation}deg)` }}
              className="max-h-60 max-w-full object-contain"
            />
          </div>
          <button
            type="button"
            onClick={() => start()}
            disabled={!!stage || !canScan}
            className={`${ui.primary} w-full`}
            aria-busy={!!stage}
          >
            {stage ? (
              <Loader2 size={18} className={ui.spinner} aria-hidden="true" />
            ) : (
              <ScanLine size={18} aria-hidden="true" />
            )}
            {stage ?? "Baca struk"}
          </button>
          <button
            type="button"
            onClick={() => start(true)}
            disabled={!!stage}
            className={`${ui.secondary} w-full`}
          >
            Isi manual saja
          </button>
          <details className="text-sm text-[#4A5B7C]">
            <summary className="min-h-11 flex items-center cursor-pointer font-semibold">
              Bagaimana foto digunakan?
            </summary>
            <p className="pt-2">
              Foto dikirim ke Google Gemini untuk membaca pesanan dan harga.
              {receiptsEnabled
                ? " Salinan foto disimpan privat selama masa akses 24 jam, lalu dihapus otomatis. Foto hanya ikut link jika kamu memilih."
                : " Penyimpanan foto online belum tersedia. Salinan referensi hanya tersedia sementara di tab ini."}
            </p>
          </details>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              disabled={!!stage || !canScan}
              className="min-h-24 p-3 rounded-xl bg-[#2855D9] hover:bg-[#1E44B8] text-white font-bold text-sm flex flex-col items-center justify-center gap-2 text-center cursor-pointer disabled:opacity-40"
            >
              <Camera size={27} aria-hidden="true" />
              <span>Foto struk</span>
            </button>
            <button
              type="button"
              onClick={() => galleryRef.current?.click()}
              disabled={!!stage || !canScan}
              className="min-h-24 p-3 rounded-xl border border-[#A8C7FA] bg-[#E6EDFF] hover:bg-[#D8E5FF] text-[#1E44B8] font-bold text-sm flex flex-col items-center justify-center gap-2 text-center cursor-pointer disabled:opacity-40"
            >
              <ImagePlus size={27} aria-hidden="true" />
              <span>Pilih dari galeri</span>
            </button>
          </div>
          {canScan && (
            <p className="text-center text-sm text-[#4A5B7C]">
              Bisa baca {remaining} struk lagi bulan ini.
            </p>
          )}
          <div className="pt-4 border-t border-[#D8E2F2]">
            <button
              type="button"
              onClick={() => start(true)}
              disabled={!!stage}
              className={`${canScan ? ui.secondary : ui.primary} w-full`}
              aria-busy={!!stage}
            >
              {stage ? (
                <Loader2 size={18} className={ui.spinner} aria-hidden="true" />
              ) : (
                <FilePenLine size={18} aria-hidden="true" />
              )}
              {stage ?? "Isi manual"}
            </button>
            <p className="mt-2 text-sm text-center text-[#4A5B7C]">
              Tanpa foto? Ketik nama pesanan dan harganya.
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
