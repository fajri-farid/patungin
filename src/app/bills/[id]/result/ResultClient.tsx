"use client";

import React, {
  useMemo,
  useRef,
  useState,
  useTransition,
  useEffect,
} from "react";
import Link from "next/link";
import { SavedPaymentPicker } from "@/components/SavedPaymentPicker";
import { OwnerReceiptPhoto } from "@/components/OwnerReceiptPhoto";
import { usePhotoAvailable } from "@/components/ReceiptPhoto";
import { loadReceiptState } from "@/lib/receipt-photo-client";
import type { ReceiptPhotoInfo } from "@/domain/receipts";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Edit3,
  ExternalLink,
  Image as ImageIcon,
  Link2,
  Link2Off,
  QrCode,
  Share2,
  Users,
  Wallet,
} from "lucide-react";
import {
  finalizeBillAction,
  publishShareAction,
  reopenBillAction,
  revokeShareAction,
  saveDraftAction,
} from "@/app/actions/bills";
import {
  buildDetailedParticipantShares,
  buildReceiptDetails,
  calculateBill,
  formatSummaryText,
} from "@/domain/billing/calculation";
import { ActionBar } from "@/components/product/ActionBar";
import dynamic from "next/dynamic";
import ui from "@/components/product/product.module.css";
import {
  billingIssueMessage,
  formatReceiptDate,
} from "@/components/product/billing-feedback";
import { formatRupiah } from "@/domain/billing/money";
import type {
  BillDocument,
  FinalizationSnapshot,
  PaymentMethodNote,
} from "@/domain/billing/types";
import { buildParticipantVisualMap } from "@/lib/palette";
import { ParticipantAvatar } from "@/components/ParticipantBadge";
import {
  StepIntro,
  StepHeader,
  type SaveStatus,
} from "@/components/StepHeader";
import { ReceiptDetails } from "@/components/ReceiptDetails";
import {
  PaymentMethodsEditor,
  PaymentMethodsList,
} from "@/components/PaymentMethods";
import {
  editablePaymentMethod,
  normalizePaymentMethods,
} from "@/domain/billing/payment";

const ShareQrCode = dynamic(
  () => import("@/components/product/ShareQrCode").then((module) => module.ShareQrCode),
  { loading: () => <p role="status">Menyiapkan QR rincian…</p> },
);

interface ResultClientProps {
  initialPhoto: ReceiptPhotoInfo;
  photoSharingEnabled: boolean;
  initialBill: BillDocument;
  initialSnapshot: FinalizationSnapshot | null;
  initialShareToken: string | null;
  appOrigin: string;
  shareLinksEnabled: boolean;
}

export function ResultClient({
  initialBill,
  initialSnapshot,
  initialShareToken,
  appOrigin,
  shareLinksEnabled,
  initialPhoto,
  photoSharingEnabled,
}: ResultClientProps) {
  const [bill, setBill] = useState<BillDocument>(initialBill);
  const [photoInfo, setPhotoInfo] = useState(initialPhoto);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [shareReceiptPhoto, setShareReceiptPhoto] = useState(initialBill.shareReceiptPhoto === true);
  const photoAvailable = usePhotoAvailable(photoInfo) && !!bill.receiptPhotoId;
  const [, setSnapshot] = useState<FinalizationSnapshot | null>(
    initialSnapshot,
  );
  const [shareToken, setShareToken] = useState<string | null>(
    initialShareToken,
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [isPending, startTransition] = useTransition();

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodNote[]>(
    normalizePaymentMethods(
      initialBill.paymentMethods,
      initialBill.paymentNote,
    ).map(editablePaymentMethod),
  );
  const [expandedParticipants, setExpandedParticipants] = useState<
    Record<string, boolean>
  >({});
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const paymentSaveInFlight = useRef(false);

  useEffect(() => {
    if (saveStatus === "saved" || bill.status === "finalized") return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [saveStatus, bill.status]);

  const runAction = (action: () => Promise<void>) => {
    startTransition(async () => {
      try {
        await action();
      } catch {
        setActionError("Belum berhasil. Periksa koneksi lalu coba lagi.");
      }
    });
  };

  const calcInput = useMemo(
    () => ({
      currency: bill.currency,
      items: bill.items,
      participants: bill.participants,
      payerParticipantId: bill.payerParticipantId,
      allocations: bill.allocations,
      adjustments: bill.adjustments,
      confirmedGrandTotal: bill.confirmedGrandTotal,
      confirmedInputHash: bill.confirmedInputHash,
    }),
    [bill],
  );

  const calc = useMemo(() => calculateBill(calcInput), [calcInput]);
  const detailedShares = useMemo(
    () => buildDetailedParticipantShares(calcInput, calc),
    [calcInput, calc],
  );

  const receiptDetails = useMemo(
    () => buildReceiptDetails(calcInput, calc),
    [calcInput, calc],
  );

  const visualMap = useMemo(
    () => buildParticipantVisualMap(bill.participants),
    [bill.participants],
  );

  const payer = bill.participants.find((p) => p.id === bill.payerParticipantId);
  const shareUrl = shareToken
    ? `${appOrigin.replace(/\/+$/, "")}/s/${shareToken}`
    : null;

  const summaryText = useMemo(
    () =>
      formatSummaryText({
        title: bill.title,
        merchant: bill.merchant,
        grandTotal: calc.computedGrandTotal,
        payerName: payer?.name ?? "Pembayar",
        participants: detailedShares,
        paymentMethods: bill.paymentMethods,
        paymentNote: bill.paymentNote,
        shareUrl,
      }),
    [
      bill.title,
      bill.merchant,
      calc.computedGrandTotal,
      payer?.name,
      detailedShares,
      bill.paymentMethods,
      bill.paymentNote,
      shareUrl,
    ],
  );

  const blockingIssues = calc.issues.filter((i) => i.severity === "error");
  const hasBlockingIssues = blockingIssues.some(
    (issue) => issue.code !== "REVIEW_HASH_STALE",
  );

  const savePaymentBeforeNavigation = async () => {
    if (isPending || photoBusy || pickerBusy || paymentSaveInFlight.current) return false;
    if (bill.status === "finalized" || saveStatus === "saved") return true;
    let normalized: PaymentMethodNote[];
    try {
      normalized = normalizePaymentMethods(paymentMethods);
    } catch (error) {
      setPaymentError(
        error instanceof Error ? error.message : "Lengkapi tujuan pembayaran.",
      );
      document
        .querySelector<HTMLInputElement>("#payment-settings input:invalid")
        ?.focus();
      return false;
    }
    paymentSaveInFlight.current = true;
    setSaveStatus("saving");
    try {
      const response = await saveDraftAction(bill.id, {
        expectedRevision: bill.revision,
        paymentMethods: normalized,
        shareReceiptPhoto: shareReceiptPhoto && photoAvailable && photoSharingEnabled,
      });
      if (!response.ok || !response.data) {
        setSaveStatus("error");
        setPaymentError(
          response.error ?? "Pembayaran belum tersimpan. Coba lagi.",
        );
        return false;
      }
      setBill(response.data);
      setSaveStatus("saved");
      return true;
    } catch {
      setSaveStatus("error");
      setPaymentError(
        "Rekening belum tersimpan. Periksa koneksi lalu coba simpan lagi.",
      );
      document
        .getElementById("payment-settings")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      document
        .querySelector<HTMLInputElement>("#payment-settings input:invalid")
        ?.focus();
      return false;
    } finally {
      paymentSaveInFlight.current = false;
    }
  };

  const handleConfirmReviewAndFinalize = () => {
    if (photoBusy || pickerBusy || isPending) return;
    setActionError(null);
    let normalized: PaymentMethodNote[];
    try {
      normalized = normalizePaymentMethods(paymentMethods);
    } catch (error) {
      setPaymentError(
        error instanceof Error ? error.message : "Lengkapi tujuan pembayaran.",
      );
      document
        .getElementById("payment-settings")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      document
        .querySelector<HTMLInputElement>("#payment-settings input:invalid")
        ?.focus();
      return;
    }
    setPaymentError(null);
    runAction(async () => {
      // Save payment instructions together with the reviewed bill.
      let currentBill = bill;
      if (currentBill.status === "draft") {
        const saveRes = await saveDraftAction(currentBill.id, {
          expectedRevision: currentBill.revision,
          items: currentBill.items.map((it) => ({
            ...it,
            reviewConfirmed: true,
          })),
          adjustments: currentBill.adjustments.map((adj) => ({
            ...adj,
            reviewConfirmed: true,
            scopeConfirmed: true,
          })),
          paymentMethods: normalized,
        shareReceiptPhoto: shareReceiptPhoto && photoAvailable && photoSharingEnabled,
          markReviewConfirmed: true,
        });
        if (!saveRes.ok || !saveRes.data) {
          setActionError(
            saveRes.error ?? "Tagihan belum tersimpan. Coba lagi.",
          );
          return;
        }
        currentBill = saveRes.data;
        setBill(currentBill);
        setSaveStatus("saved");
      }

      const finRes = await finalizeBillAction({
        billId: currentBill.id,
        expectedRevision: currentBill.revision,
      });

      if (!finRes.ok || !finRes.data) {
        setActionError(
          finRes.error ?? "Tagihan belum bisa diselesaikan. Coba lagi.",
        );
        return;
      }

      setBill(finRes.data.bill);
      setSnapshot(finRes.data.snapshot);
      setPaymentMethods(normalized);
      setSaveStatus("saved");
      if (shareLinksEnabled) {
        const published = await publishShareAction({
          billId: bill.id,
          expectedRevision: finRes.data.bill.revision,
        });
        if (published.ok && published.data) {
          setBill(published.data.bill);
          setShareToken(published.data.shareToken);
        } else {
          setActionError(
            "Tagihan tersimpan, tetapi link belum berhasil dibuat. Tekan Buat link untuk mencoba lagi.",
          );
        }
      }
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  };

  const handlePublishShareLink = () => {
    setActionError(null);
    setShareError(null);
    runAction(async () => {
      const res = await publishShareAction({
        billId: bill.id,
        expectedRevision: bill.revision,
      });
      if (!res.ok || !res.data) {
        setShareError(
          res.code === "INTERNAL_ERROR"
            ? "Link belum berhasil dibuat. Coba lagi."
            : (res.error ?? "Link belum berhasil dibuat. Coba lagi."),
        );
        return;
      }
      setBill(res.data.bill);
      setShareToken(res.data.shareToken);
    });
  };

  const handleRevokeShareLink = () => {
    if (
      !window.confirm(
        "Nonaktifkan link ini? Teman tidak bisa lagi membuka rincian dari link tersebut.",
      )
    ) {
      return;
    }
    setActionError(null);
    runAction(async () => {
      const res = await revokeShareAction({ billId: bill.id });
      if (!res.ok || !res.data) {
        setActionError(res.error ?? "Link belum bisa dinonaktifkan. Coba lagi.");
        return;
      }
      setBill(res.data);
      setShareToken(null);
      setShowQr(false);
    });
  };

  const handleReopenToEdit = () => {
    if (
      !window.confirm(
        "Ubah tagihan ini? Link yang sudah dibagikan akan dinonaktifkan.",
      )
    ) {
      return;
    }
    setActionError(null);
    runAction(async () => {
      const res = await reopenBillAction({
        billId: bill.id,
        expectedRevision: bill.revision,
      });
      if (!res.ok || !res.data) {
        setActionError(res.error ?? "Tagihan belum bisa diubah. Coba lagi.");
        return;
      }
      setBill(res.data);
      setShareToken(null);
      setShowQr(false);
    });
  };

  const handleCopySummary = async () => {
    setActionError(null);
    try {
      await navigator.clipboard.writeText(summaryText);
    } catch {
      setActionError(
        "Pesan belum bisa disalin. Pilih teks ringkasan, lalu salin lewat menu browser.",
      );
      return;
    }
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2500);
  };

  const handleCopyShareLink = async () => {
    if (!shareUrl) return;
    setActionError(null);
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      setActionError(
        "Link belum bisa disalin. Pilih link di bawah, lalu salin lewat menu browser.",
      );
      return;
    }
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  return (
    <div
      className={`${ui.page} ${bill.status === "draft" ? "pb-32" : "pb-16"}`}
    >
      <StepHeader
        billId={bill.id}
        title={bill.title}
        merchant={bill.merchant}
        activeStep="result"
        saveStatus={saveStatus}
        onRetrySave={() => {
          void savePaymentBeforeNavigation();
        }}
        onBeforeNavigate={savePaymentBeforeNavigation}
      />

      <main id="bill-content" tabIndex={-1} className={ui.main}>
        <StepIntro
          activeStep="result"
          completed={bill.status === "finalized"}
        />
        <fieldset
          disabled={isPending || pickerBusy}
          className={`${ui.panel} space-y-3`}
        >
          <div className="flex items-center gap-2 pb-2.5 border-b border-[#D8E2F2]">
            <span className="w-7 h-7 rounded-lg bg-[#E6EDFF] text-[#2855D9] flex items-center justify-center shrink-0">
              <ImageIcon className="w-4 h-4" aria-hidden="true" />
            </span>
            <h2 className={ui.sectionTitle}>Foto struk</h2>
          </div>
          <OwnerReceiptPhoto
            bill={bill}
            initialPhoto={initialPhoto}
            prepareBill={async () => {
              if (!(await savePaymentBeforeNavigation())) return null;
              return (await loadReceiptState(bill.id)).bill;
            }}
            onChange={(next, photo) => {
              setBill(next);
              setPhotoInfo(photo);
            }}
            onBusy={setPhotoBusy}
          />
        </fieldset>
        <fieldset disabled={photoBusy} className="contents">
        {actionError && (
          <div
            role="alert"
            className="p-3.5 rounded-2xl bg-[#FDECEC] border border-[#F5B5B5] text-xs font-bold text-[#B42318]"
          >
            {actionError}
          </div>
        )}

        {/* Masalah Pemblokir Finalisasi (Jika Masih Ada Item Belum Dibagi / Selisih) */}
        {hasBlockingIssues && (
          <section className="bg-[#FFF3E6] border-2 border-[#F5CA86] rounded-3xl p-4 space-y-3">
            <div className="flex items-start gap-2.5 text-[#9A4A12]">
              <AlertTriangle
                className="w-5 h-5 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div>
                <h2 className="text-sm font-extrabold font-display">
                  Lengkapi tagihan sebelum dibagikan:
                </h2>
                <ul className="mt-1.5 space-y-1 text-xs list-disc list-inside">
                  {blockingIssues
                    .filter((i) => i.code !== "REVIEW_HASH_STALE")
                    .map((issue, idx) => (
                      <li key={`${issue.code}-${idx}`}>
                        {billingIssueMessage(issue, bill)}
                      </li>
                    ))}
                </ul>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href={`/bills/${bill.id}/review`}
                className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-white border border-[#9A4A12] text-[#9A4A12] font-bold text-xs inline-flex items-center"
              >
                Cek struk
              </Link>
              <Link
                href={`/bills/${bill.id}/split`}
                className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-[#9A4A12] text-white font-bold text-xs inline-flex items-center"
              >
                Bagi pesanan
              </Link>
            </div>
          </section>
        )}

        {/* Kartu Ringkasan Utama Tagihan */}
        <section className={`${ui.panel} space-y-4`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                    bill.status === "finalized"
                      ? "bg-[#E6F5EF] text-[#146346]"
                      : "bg-[#FFF3E6] text-[#9A4A12]"
                  }`}
                >
                  {bill.status === "finalized"
                    ? "Selesai"
                    : "Cek sebelum simpan"}
                </span>
                {bill.activeShareId && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E6EDFF] text-[#1E44B8]">
                    Link aktif
                  </span>
                )}
              </div>
              <h2 className="text-lg font-extrabold text-[#17233B] font-display mt-1.5">
                {bill.title}
              </h2>
              <p className="text-xs text-[#4A5B7C]">
                {bill.merchant || "Makan bersama"} ·{" "}
                {formatReceiptDate(bill.receiptDate) || "Tanggal belum diisi"}
              </p>
            </div>

            <div className="text-right">
              <span className="text-[11px] font-semibold text-[#4A5B7C] block">
                Total tagihan
              </span>
              <span className="text-xl font-extrabold text-[#17233B] tabular-money">
                {formatRupiah(calc.computedGrandTotal)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 p-3.5 rounded-2xl bg-[#F4F7FC] border border-[#D8E2F2] text-xs">
            <div>
              <span className="text-[#4A5B7C] block">Ditalangi oleh</span>
              <span className="font-extrabold text-[#17233B] text-sm mt-0.5 block">
                {payer?.name ?? "—"}
              </span>
            </div>
            <div className="text-right">
              <span className="text-[#4A5B7C] block">
                Teman perlu bayar ke {payer?.name ?? "pembayar"}
              </span>
              <span className="font-extrabold text-[#2855D9] text-sm tabular-money mt-0.5 block">
                {formatRupiah(calc.totalReceivableByPayer)}
              </span>
            </div>
          </div>

          {bill.status === "finalized" ? (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#D8E2F2]">
              <span className="text-xs sm:text-sm font-bold text-[#146346] inline-flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                Siap dibagikan
              </span>
              <button
                type="button"
                disabled={isPending}
                onClick={handleReopenToEdit}
                className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-[#F4F7FC] hover:bg-[#EAF0FA] border border-[#D8E2F2] text-xs font-bold text-[#17233B] inline-flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                Ubah tagihan
              </button>
            </div>
          ) : (
            <p className="text-sm text-[#4A5B7C]">
              Periksa rincian sebelum menyimpan hasil.
            </p>
          )}
        </section>

        {bill.status === "finalized" && (
          /* Salin Pesan Teks (WhatsApp / Chat) */
          <section
            aria-labelledby="heading-salin-pesan"
            className={`${ui.panel} space-y-4`}
          >
            <div className="flex items-start gap-2.5 pb-2.5 border-b border-[#D8E2F2]">
              <span className="w-7 h-7 rounded-lg bg-[#E6EDFF] text-[#2855D9] flex items-center justify-center shrink-0 mt-0.5">
                <Share2 className="w-4 h-4" aria-hidden="true" />
              </span>
              <div className="space-y-0.5">
                <h2 id="heading-salin-pesan" className={ui.sectionTitle}>
                  Bagikan ke teman
                </h2>
                <p className="text-xs text-[#4A5B7C]">
                  Kirim ringkasan ke grup atau salin pesannya. Teman bisa cek
                  jumlah yang perlu dibayar.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <a
                href={`https://api.whatsapp.com/send?text=${encodeURIComponent(
                  summaryText,
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[46px] px-3.5 py-2 rounded-2xl bg-[#146346] hover:bg-[#0F5239] text-white font-bold text-xs inline-flex items-center justify-center gap-1.5 transition-colors shadow-2xs text-center"
              >
                Kirim ke WhatsApp
              </a>
              <button
                type="button"
                onClick={handleCopySummary}
                className="min-h-[46px] px-4 py-2 rounded-2xl bg-[#2855D9] hover:bg-[#1E44B8] text-white font-bold text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs transition-colors"
              >
                {copiedSummary ? (
                  <>
                    <Check className="w-4 h-4" aria-hidden="true" />
                    Tersalin
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" aria-hidden="true" />
                    Salin pesan
                  </>
                )}
              </button>
            </div>

            <details className="rounded-2xl bg-[#F4F7FC] border border-[#D8E2F2] px-3.5 py-2">
              <summary className="min-h-[38px] flex items-center text-xs font-bold text-[#2855D9] cursor-pointer">
                Lihat isi pesan
              </summary>
              <pre className="mt-2 pt-2.5 border-t border-[#D8E2F2] text-xs text-[#17233B] font-sans whitespace-pre-wrap break-words leading-relaxed">
                {summaryText}
              </pre>
            </details>
          </section>
        )}

        {bill.status === "finalized" && (
          <ReceiptDetails
            details={receiptDetails}
            grandTotal={calc.computedGrandTotal}
          />
        )}

        {/* Rincian Bagian Setiap Orang */}
        <section
          aria-labelledby="heading-rincian-orang"
          className={`${ui.panel} space-y-4`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#D8E2F2]">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-[#E6EDFF] text-[#2855D9] flex items-center justify-center shrink-0">
                <Users className="w-4 h-4" aria-hidden="true" />
              </span>
              <h2 id="heading-rincian-orang" className={ui.sectionTitle}>
                Bagian tiap orang ({detailedShares.length})
              </h2>
            </div>
            <span className="text-xs font-semibold text-[#4A5B7C]">
              Ketuk nama untuk buka rincian
            </span>
          </div>

          <div className="space-y-2.5">
            {detailedShares.map((person) => {
              const identity = visualMap[person.id];
              const isOpen = expandedParticipants[person.id] ?? false;

              return (
                <div
                  key={person.id}
                  className="rounded-2xl border border-[#D8E2F2] bg-[#F4F7FC]/60 overflow-hidden"
                >
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`person-details-${person.id}`}
                    onClick={() =>
                      setExpandedParticipants((prev) => ({
                        ...prev,
                        [person.id]: !isOpen,
                      }))
                    }
                    className={ui.personToggle}
                  >
                    <div className={ui.personIdentity}>
                      {identity && <ParticipantAvatar identity={identity} />}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-extrabold text-[#17233B] break-words">
                            {identity?.displayLabel ?? person.name}
                          </span>
                          {person.isPayer && (
                            <span className="shrink-0 whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#17233B] text-white">
                              Pembayar
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#4A5B7C]">
                          {person.isPayer
                            ? "Sudah membayar tagihan lebih dulu"
                            : `Bayar ke ${payer?.name ?? "pembayar"}`}
                        </p>
                      </div>
                    </div>

                    <div className={ui.personToggleAmount}>
                      <div className="text-right">
                        <span
                          className={`text-sm font-extrabold tabular-money block ${
                            person.isPayer ? "text-[#4A5B7C]" : "text-[#2855D9]"
                          }`}
                        >
                          {person.isPayer
                            ? formatRupiah(person.consumptionTotal)
                            : formatRupiah(person.transferToPayerAmount)}
                        </span>
                        <span className="text-[10px] font-bold text-[#7687A6]">
                          {person.isPayer ? "Bagian sendiri" : "Perlu dibayar"}
                        </span>
                      </div>
                      {isOpen ? (
                        <ChevronUp
                          className="w-4 h-4 text-[#7687A6]"
                          aria-hidden="true"
                        />
                      ) : (
                        <ChevronDown
                          className="w-4 h-4 text-[#7687A6]"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  </button>

                  {isOpen && (
                    <div
                      id={`person-details-${person.id}`}
                      className="px-3.5 py-3 border-t border-[#D8E2F2] space-y-1.5 text-xs"
                    >
                      {person.items.map((it) => (
                        <div
                          key={it.itemId}
                          className="flex items-start justify-between gap-4 text-[#17233B]"
                        >
                          <span>
                            {it.mode === "units"
                              ? `${it.units}x ${it.itemName}`
                              : `${it.itemName} (bagi ${it.sharedParticipantCount} orang)`}
                          </span>
                          <span className="font-semibold tabular-money shrink-0">
                            {formatRupiah(it.grossShare)}
                          </span>
                        </div>
                      ))}

                      {person.adjustments.map((adj) => (
                        <div
                          key={adj.adjustmentId}
                          className={`flex items-center justify-between ${
                            adj.mode === "included"
                              ? "text-[#7687A6] italic"
                              : adj.signedAmount < 0
                                ? "text-[#146346]"
                                : "text-[#4A5B7C]"
                          }`}
                        >
                          <span>
                            {adj.name}
                            {adj.mode === "included" ? " (sudah termasuk)" : ""}
                          </span>
                          <span className="font-semibold tabular-money shrink-0">
                            {adj.mode === "included"
                              ? formatRupiah(adj.absoluteAmount)
                              : `${adj.signedAmount < 0 ? "-" : "+"}${formatRupiah(
                                  adj.absoluteAmount,
                                )}`}
                          </span>
                        </div>
                      ))}

                      <div className="pt-1.5 border-t border-[#D8E2F2] flex items-center justify-between font-bold text-[#17233B]">
                        <span>Total bagian {person.name}</span>
                        <span className="tabular-money">
                          {formatRupiah(person.consumptionTotal)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Pengaturan / Daftar Tujuan Pembayaran */}
        <section
          id="payment-settings"
          className={`${ui.panel} space-y-3.5 scroll-mt-36`}
        >
          <div className="flex items-start gap-2.5 pb-2.5 border-b border-[#D8E2F2]">
            <span className="w-7 h-7 rounded-lg bg-[#E6EDFF] text-[#2855D9] flex items-center justify-center shrink-0 mt-0.5">
              <Wallet className="w-4 h-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className={ui.sectionTitle}>
                {bill.status === "draft"
                  ? "Tujuan pembayaran (opsional)"
                  : "Cara bayar"}
              </h2>
              {bill.status === "draft" && (
                <p className="text-xs text-[#4A5B7C] mt-0.5">
                  Cantumkan rekening, e-wallet, atau QRIS agar teman tahu harus
                  transfer ke mana.
                </p>
              )}
            </div>
          </div>

          {paymentError && (
            <p
              role="alert"
              className="rounded-2xl bg-[#FDECEC] border border-[#F5B5B5] p-3 text-xs font-bold text-[#B42318]"
            >
              {paymentError}
            </p>
          )}

          {bill.status === "draft" && <SavedPaymentPicker disabled={isPending || photoBusy} onBusy={setPickerBusy} onUse={methods => {
            const current = paymentMethods;
            const signature = (method: PaymentMethodNote) => JSON.stringify([method.method, method.qrisImageId, method.bankOrWalletName?.trim(), method.accountNumber?.trim(), method.accountHolderName?.trim(), method.note?.trim() || ""]);
            const seen = new Set(current.map(signature));
            const additions = methods.filter(method => { const key = signature(method); if (seen.has(key)) return false; seen.add(key); return true; });
            if (current.length + additions.length > 10) { setPaymentError("Maksimal 10 tujuan pembayaran per tagihan."); return; }
            setPaymentMethods([...paymentMethods, ...additions]); setPaymentError(null); setSaveStatus("idle");
          }} />}
          {bill.status === "draft" ? (
            <PaymentMethodsEditor
              value={paymentMethods}
              disabled={isPending}
              onChange={(value) => {
                setPaymentMethods(value);
                setPaymentError(null);
                setSaveStatus("idle");
              }}
            />
          ) : paymentMethods.length ? (
            <PaymentMethodsList
              payments={paymentMethods}
              payerName={payer?.name ?? "pembayar"}
            />
          ) : (
            <p className="text-xs text-[#4A5B7C] bg-[#F4F7FC] border border-[#D8E2F2] rounded-2xl p-3.5">
              Hubungi {payer?.name ?? "pembayar"} untuk cara pembayaran.
            </p>
          )}
        </section>

        {bill.status === "draft" && photoSharingEnabled && (
          <section
            className={`${ui.panel} space-y-2.5 transition-colors ${
              shareReceiptPhoto && photoAvailable
                ? "border-[#9DC0FB] bg-[#F8FAFF]"
                : ""
            }`}
          >
            <label
              className={`flex items-start gap-3 text-sm font-bold ${
                photoAvailable ? "cursor-pointer" : "opacity-65"
              }`}
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={shareReceiptPhoto && photoAvailable}
                disabled={isPending || !photoAvailable}
                onChange={(event) => {
                  setShareReceiptPhoto(event.target.checked);
                  setSaveStatus("idle");
                }}
              />
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block text-[#17233B]">
                  Bagikan juga foto struk
                </span>
                <span className="block text-xs font-normal text-[#4A5B7C]">
                  {photoAvailable
                    ? "Siapa pun yang punya link bisa melihat foto hingga 24 jam sejak foto disimpan."
                    : "Simpan foto struk di atas agar bisa ikut dibagikan."}
                </span>
              </span>
            </label>
          </section>
        )}
        {bill.status === "draft" && (
          <section className={ui.notice}>
            <p className="text-xs sm:text-sm text-[#4A5B7C]">
              {shareLinksEnabled
              ? "Simpan hasil agar teman bisa membuka rinciannya tanpa login."
                : "Simpan hasil dan tujuan pembayaran untuk dibagikan ke teman."}
            </p>
          </section>
        )}

        {bill.status === "finalized" && (
          <section
            aria-labelledby="heading-share-link"
            className={`${ui.panel} space-y-4`}
          >
            <div className="flex items-start gap-2.5 pb-2.5 border-b border-[#D8E2F2]">
              <span className="w-7 h-7 rounded-lg bg-[#E6EDFF] text-[#2855D9] flex items-center justify-center shrink-0 mt-0.5">
                <Link2 className="w-4 h-4" aria-hidden="true" />
              </span>
              <div>
                <h2 id="heading-share-link" className={ui.sectionTitle}>
                  Link rincian tagihan
                </h2>
                <p className="text-xs text-[#4A5B7C] mt-0.5">
                  Link berlaku 7 hari sejak dibuat. Siapa pun yang punya link bisa
                  melihat pesanan dan cara bayar. Foto hanya ikut jika dipilih,
                  dan bisa dibuka hingga 24 jam sejak disimpan.
                </p>
              </div>
            </div>

            {shareError && (
              <p
                role="alert"
                className="rounded-xl bg-[#FDECEC] p-3 text-sm text-[#B42318]"
              >
                {shareError}
              </p>
            )}
            {!shareLinksEnabled ? (
              <div className="p-3.5 rounded-2xl bg-[#FFF3E6] border border-[#F5CA86] text-xs text-[#9A4A12] flex items-center gap-2">
                <AlertTriangle
                  className="w-4 h-4 shrink-0"
                  aria-hidden="true"
                />
                Link rincian sedang tidak tersedia. Kamu tetap bisa membagikan
                pesan ringkasan.
              </div>
            ) : !shareUrl ? (
              <button
                type="button"
                disabled={isPending}
                onClick={handlePublishShareLink}
                className="w-full min-h-[46px] rounded-2xl bg-[#E6EDFF] hover:bg-[#D4E2FF] text-[#1E44B8] font-bold text-xs px-4 flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <Link2 className="w-4 h-4" aria-hidden="true" />
                {isPending ? "Membuat link…" : "Buat link"}
              </button>
            ) : (
              <div className="space-y-2.5">
                <div className="p-3.5 rounded-2xl bg-[#E6F5EF] border border-[#9ADBC3] text-xs text-[#146346] space-y-1.5">
                  <p className="font-bold">
                    Link aktif · berlaku 7 hari sejak dibuat
                  </p>
                  <p className="font-mono text-[11px] break-all bg-white/90 px-2.5 py-1.5 rounded-xl border border-[#9ADBC3]/60">
                    {shareUrl}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleCopyShareLink}
                    className="min-h-11 px-2 py-2 rounded-xl bg-[#2855D9] text-white font-bold text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {copiedLink ? (
                      <>
                        <Check className="w-3.5 h-3.5" aria-hidden="true" />{" "}
                        Link tersalin
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />{" "}
                        Salin link
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowQr((visible) => !visible)}
                    aria-expanded={showQr}
                    aria-controls={showQr ? "share-qr-panel" : undefined}
                    className="min-h-11 px-2 py-2 rounded-xl bg-[#F4F7FC] hover:bg-[#EAF0FA] border border-[#D8E2F2] text-xs font-bold text-[#17233B] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <QrCode
                      className="w-4 h-4 text-[#2855D9]"
                      aria-hidden="true"
                    />
                    {showQr ? "Tutup QR" : "Tampilkan QR"}
                  </button>

                  <Link
                    href={`/s/${shareToken}`}
                    target="_blank"
                    className="min-h-11 px-2 py-2 rounded-xl bg-[#F4F7FC] hover:bg-[#EAF0FA] border border-[#D8E2F2] text-xs font-bold text-[#17233B] inline-flex items-center justify-center gap-1.5"
                  >
                    <ExternalLink
                      className="w-3.5 h-3.5 text-[#2855D9]"
                      aria-hidden="true"
                    />
                    Lihat rincian
                  </Link>

                  <button
                    type="button"
                    disabled={isPending}
                    onClick={handleRevokeShareLink}
                    className="min-h-11 px-2 py-2 rounded-xl bg-[#FDECEC] hover:bg-[#FAD4D4] text-[#B42318] font-bold text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Link2Off className="w-3.5 h-3.5" aria-hidden="true" />
                    Nonaktifkan link
                  </button>
                </div>
                {showQr && <ShareQrCode url={shareUrl} />}
              </div>
            )}
          </section>
        )}
        <p role="status" className="sr-only">
          {copiedSummary
            ? "Pesan berhasil disalin."
            : copiedLink
              ? "Link berhasil disalin."
              : isPending
                ? "Menyimpan hasil…"
                : ""}
        </p>
        </fieldset>
      </main>

      {bill.status === "draft" && (
        <ActionBar
          title={hasBlockingIssues ? "Periksa rincian dulu" : "Siap disimpan"}
          detail={formatRupiah(calc.computedGrandTotal)}
          label={shareLinksEnabled ? "Simpan & buat link" : "Simpan hasil"}
          pendingLabel={
            photoBusy
              ? "Menunggu foto…"
              : pickerBusy
                ? "Memuat tujuan pembayaran…"
                : "Menyimpan…"
          }
          pending={isPending || photoBusy || pickerBusy}
          disabled={hasBlockingIssues || photoBusy || pickerBusy}
          onClick={handleConfirmReviewAndFinalize}
        />
      )}
    </div>
  );
}
