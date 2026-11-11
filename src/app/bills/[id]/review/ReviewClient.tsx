"use client";

import React, { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Calculator,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Percent,
  Plus,
  ReceiptText,
  Store,
  Trash2,
} from "lucide-react";
import { reopenBillAction } from "@/app/actions/bills";
import { calculateBillForReview } from "@/domain/billing/calculation";
import { ActionBar } from "@/components/product/ActionBar";
import ui from "@/components/product/product.module.css";
import { billingIssueMessage } from "@/components/product/billing-feedback";
import { formatRupiah, isValidIdrInteger } from "@/domain/billing/money";
import { proposeLineAmountRecovery } from "@/domain/billing/recovery";
import { hasUnitPriceMismatch, mergeReceiptItem, needsQuantityReview, receiptAdjustmentLabel, receiptItemFeedback, receiptWarningMessages } from "@/domain/billing/receipt-review";
import { ReceiptItemNotice } from "@/components/ReceiptItemNotice";
import { DiscountTreatmentNotice } from "@/components/DiscountTreatmentNotice";
import type {
  AdjustmentKind,
  BillAdjustment,
  BillDocument,
  BillItem,
} from "@/domain/billing/types";
import { MoneyInput } from "@/components/MoneyInput";
import { StepIntro, StepHeader } from "@/components/StepHeader";
import { OwnerReceiptPhoto } from "@/components/OwnerReceiptPhoto";
import type { ReceiptPhotoInfo } from "@/domain/receipts";
import { useBillDraft } from "@/components/useBillDraft";

interface ReviewClientProps {
  initialBill: BillDocument;
  initialPhoto: ReceiptPhotoInfo;
  photoNotSaved?: boolean;
}

export function ReviewClient({ initialBill, initialPhoto, photoNotSaved }: ReviewClientProps) {
  const router = useRouter();
  const { bill, saveStatus, saveError, updateBillState, saveNow, replaceBill } =
    useBillDraft(initialBill, (current) => ({
      title: current.title,
      merchant: current.merchant,
      receiptDate: current.receiptDate,
      items: current.items,
      participants: current.participants,
      payerParticipantId: current.payerParticipantId,
      allocations: current.allocations,
      adjustments: current.adjustments,
      confirmedGrandTotal: current.confirmedGrandTotal,
    }));

  const [photoBusy, setPhotoBusy] = useState(false);
  const [proceedPending, setProceedPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedItemDetails, setExpandedItemDetails] = useState<
    Record<string, boolean>
  >({});

  const idSeqRef = useRef<number>(100);

  // Hitung rekonsiliasi secara langsung dengan mesin hitung domain yang sama dengan server
  const calc = useMemo(
    () =>
      calculateBillForReview({
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

  const reviewIssues = calc.issues.filter(
    (i) =>
      (i.stage === "review" || i.stage === "reconciliation") &&
      ![
        "REVIEW_HASH_STALE",
        "ITEM_UNCONFIRMED",
        "ADJUSTMENT_UNCONFIRMED",
        "CONSERVATION_MISMATCH",
      ].includes(i.code),
  );
  const hasMissingAmounts =
    bill.items.some((item) => !isValidIdrInteger(item.lineAmount)) ||
    bill.adjustments.some(
      (adj) =>
        !isValidIdrInteger(adj.amount) && adj.amountSource === "observed",
    );
  const lineRecovery = proposeLineAmountRecovery({ ...bill });
  const scanWarnings = receiptWarningMessages(bill.extractionWarnings ?? []);

  const handleMergeItem = (childId: string, parentId: string) => {
    const parent = bill.items.find(item => item.id === parentId);
    const child = bill.items.find(item => item.id === childId);
    if (!parent || !child || !window.confirm(`Gabungkan “${child.name}” ke “${parent.name}”? Total tetap ${formatRupiah(parent.lineAmount)}. Pastikan harga ini sudah termasuk tambahan tersebut.`)) return;
    const merged = mergeReceiptItem(bill, childId, parentId);
    if (merged === bill) {
      setActionError("Pesanan ini sudah dibagi ke teman. Kosongkan pembagiannya sebelum menggabungkan.");
      return;
    }
    updateBillState(() => merged);
  };

  const handleAddItem = () => {
    const nextOrder =
      bill.items.reduce((max, i) => Math.max(max, i.allocationOrder), -1) + 1;
    idSeqRef.current += 1;
    const newItemId = `item_${nextOrder}_${idSeqRef.current}`;

    const newItem: BillItem = {
      id: newItemId,
      allocationOrder: nextOrder,
      name: "",
      quantity: 1,
      unitPrice: null,
      lineAmount: null,
      reviewConfirmed: true,
    };

    updateBillState((prev) => ({
      ...prev,
      items: [...prev.items, newItem],
      allocations: [
        ...prev.allocations,
        {
          itemId: newItemId,
          mode: "units",
          unitCounts: {},
        },
      ],
      adjustments: prev.adjustments.map((adj) => ({
        ...adj,
        eligibleItemIds: [...adj.eligibleItemIds, newItemId],
      })),
    }));
  };

  const handleRemoveItem = (itemId: string) => {
    if (bill.items.length <= 1) return;
    const item = bill.items.find((entry) => entry.id === itemId);
    if (
      !window.confirm(
        `Hapus pesanan “${item?.name || "Tanpa nama"}”? Pembagiannya juga akan dihapus.`,
      )
    )
      return;
    updateBillState((prev) => ({
      ...prev,
      items: prev.items.filter((i) => i.id !== itemId),
      allocations: prev.allocations.filter((a) => a.itemId !== itemId),
      adjustments: prev.adjustments.map((adj) => ({
        ...adj,
        eligibleItemIds: adj.eligibleItemIds.filter((id) => id !== itemId),
      })),
    }));
  };

  const handleAddAdjustmentPreset = (kind: AdjustmentKind) => {
    const nextOrder =
      bill.adjustments.reduce(
        (max, a) => Math.max(max, a.allocationOrder),
        -1,
      ) + 1;
    idSeqRef.current += 1;
    const id = `adj_${nextOrder}_${idSeqRef.current}`;
    const allItemIds = bill.items.map((i) => i.id);
    const existingService = bill.adjustments.find(
      (a) => a.kind === "service" && a.mode === "added",
    );

    let newAdj: BillAdjustment;
    if (kind === "service") {
      newAdj = {
        id,
        allocationOrder: nextOrder,
        name: "Biaya layanan (5%)",
        kind: "service",
        amount: Math.round(calc.computedItemsSubtotal * 0.05),
        amountSource: "observed",
        mode: "added",
        basis: "net",
        eligibleItemIds: allItemIds,
        scopeConfirmed: true,
        rateBps: 500,
        reviewConfirmed: true,
      };
    } else if (kind === "tax") {
      const baseWithService =
        calc.computedItemsSubtotal -
        calc.computedDiscountsTotal +
        (existingService?.amount ?? 0);
      newAdj = {
        id,
        allocationOrder: nextOrder,
        name: "Pajak (10%)",
        kind: "tax",
        amount: Math.round(baseWithService * 0.1),
        amountSource: "observed",
        mode: "added",
        basis: "net",
        eligibleItemIds: allItemIds,
        dependsOnAdjustmentIds: existingService ? [existingService.id] : [],
        scopeConfirmed: true,
        rateBps: 1000,
        reviewConfirmed: true,
      };
    } else if (kind === "bill-discount") {
      newAdj = {
        id,
        allocationOrder: nextOrder,
        name: "Diskon",
        kind: "bill-discount",
        amount: null,
        amountSource: "observed",
        mode: "added",
        basis: "net",
        eligibleItemIds: allItemIds,
        scopeConfirmed: true,
        reviewConfirmed: true,
      };
    } else {
      newAdj = {
        id,
        allocationOrder: nextOrder,
        name: "Pembulatan struk",
        kind: "rounding",
        amount: null,
        sign: "positive",
        directionNeedsReview: true,
        amountSource: "observed",
        mode: "added",
        basis: "net",
        eligibleItemIds: allItemIds,
        scopeConfirmed: true,
        reviewConfirmed: true,
        reason: "",
      };
    }

    updateBillState((prev) => ({
      ...prev,
      adjustments: [...prev.adjustments, newAdj],
    }));
  };

  const handleSaveAndProceedToSplit = async () => {
    if (
      proceedPending ||
      hasMissingAmounts ||
      reviewIssues.some(issue => issue.severity === "error") ||
      bill.items.some((item) => !item.name.trim())
    )
      return;
    setProceedPending(true);
    if (bill.status !== "finalized") {
      updateBillState((current) => ({
        ...current,
        items: current.items.map((item) => ({
          ...item,
          reviewConfirmed: true,
          ambiguityReason: null,
        })),
        adjustments: current.adjustments.map((adjustment) => ({
          ...adjustment,
          reviewConfirmed: true,
          scopeConfirmed: adjustment.scopeConfirmed,
        })),
      }));
    }
    if (await saveNow(true)) router.push(`/bills/${bill.id}/split`);
    else setProceedPending(false);
  };

  const handleReopenBill = async () => {
    if (
      !window.confirm(
        "Ubah tagihan ini? Link yang sudah dibagikan akan dinonaktifkan.",
      )
    ) {
      return;
    }
    try {
      const res = await reopenBillAction({
        billId: bill.id,
        expectedRevision: bill.revision,
      });
      if (!res.ok || !res.data) {
        setActionError(res.error ?? "Tagihan belum bisa diubah. Coba lagi.");
        return;
      }
      replaceBill(res.data);
      setActionError(null);
    } catch {
      setActionError(
        "Tagihan belum bisa diubah. Periksa koneksi lalu coba lagi.",
      );
    }
  };

  const isLockedFinal = bill.status === "finalized";

  return (
    <div className={`${ui.page} pb-36`}>
      <StepHeader
        billId={bill.id}
        title={bill.title}
        merchant={bill.merchant}
        activeStep="review"
        saveStatus={saveStatus}
        onRetrySave={() => {
          void saveNow();
        }}
        onBeforeNavigate={async () => !photoBusy && Boolean(await saveNow())}
      />

      <main id="bill-content" tabIndex={-1} className={ui.main}>
        <StepIntro activeStep="review" />
        <section id="receipt-photo-reference" className={`${ui.panel} space-y-3 scroll-mt-4`}>
          <div className="flex items-center gap-2 pb-2.5 border-b border-[#D8E2F2]">
            <span className="w-7 h-7 rounded-lg bg-[#E6EDFF] text-[#2855D9] flex items-center justify-center shrink-0">
              <ImageIcon className="w-4 h-4" aria-hidden="true" />
            </span>
            <h2 className={ui.sectionTitle}>Foto struk</h2>
          </div>
          {photoNotSaved && !bill.receiptPhotoId && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-[#F5CA86] bg-[#FFF8F0] p-3 text-xs font-semibold text-[#9A4A12]"
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                Foto belum tersimpan. Pilih ulang foto agar bisa dibuka di perangkat lain. Pesanan tidak perlu dibaca ulang.
              </span>
            </div>
          )}
          <OwnerReceiptPhoto
            bill={bill}
            initialPhoto={initialPhoto}
            prepareBill={() => saveNow()}
            onChange={replaceBill}
            onBusy={setPhotoBusy}
          />
        </section>
        <fieldset disabled={photoBusy || proceedPending} className="contents">
        {actionError && (
          <p className={ui.error} role="alert">
            {actionError}
          </p>
        )}
        {hasMissingAmounts && (bill.scanAttemptCount ?? 0) > 0 && (
          <aside
            role="alert"
            className="p-4 rounded-3xl bg-[#FFF3E6] border border-[#F5CA86] text-xs text-[#9A4A12] space-y-3 shadow-2xs"
          >
            <p className="font-bold text-sm">Ada harga yang belum diisi</p>
            <p className="leading-relaxed">
              {isValidIdrInteger(bill.confirmedGrandTotal)
                ? `Total di struk ${formatRupiah(
                    bill.confirmedGrandTotal,
                  )}, tetapi ada harga pesanan yang belum diisi.`
                : "Sebagian harga belum terbaca. Lengkapi harga pesanan sebelum melanjutkan."}
            </p>
            {lineRecovery && !isLockedFinal && (
              <>
                <p className="leading-relaxed">
                  {lineRecovery.recoveredCount} harga pesanan bisa dihitung dari
                  harga satuan × jumlah. Totalnya {formatRupiah(lineRecovery.grandTotal)}{" "}
                  cocok dengan struk. Cek tiap pesanan sebelum memakai hasil hitungan.
                </p>
                <button
                  type="button"
                  disabled={saveStatus === "saving"}
                  onClick={() =>
                    updateBillState((prev) => {
                      const proposal = proposeLineAmountRecovery(prev);
                      return proposal
                        ? {
                            ...prev,
                            items: proposal.items,
                            confirmedInputHash: null,
                          }
                        : prev;
                    })
                  }
                  className="min-h-[44px] px-3.5 py-2 rounded-xl bg-white border border-[#9A4A12] font-bold cursor-pointer disabled:opacity-50"
                >
                  Lengkapi dari harga × jumlah
                </button>
              </>
            )}
          </aside>
        )}

        {scanWarnings.length > 0 && (
          <aside
            className="p-4 rounded-3xl bg-[#FFF8E7] border border-[#E8CB83] text-xs text-[#594314] space-y-2 shadow-2xs"
            aria-label="Catatan hasil scan"
          >
            <p className="font-bold text-sm">Catatan hasil scan</p>
            <p>
              Catatan ini dari scan awal. Cek foto struk dan perbaiki pesanan jika perlu.
            </p>
            <ul className="list-disc pl-4 space-y-1">
              {scanWarnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </aside>
        )}

        {/* Banner Konflik Dua Tab */}
        {saveError && (
          <div
            role="alert"
            className="p-4 rounded-3xl bg-[#FDECEC] border border-[#F5B5B5] text-xs text-[#B42318] space-y-2"
          >
            <p className="font-bold">{saveError}</p>
            <button
              type="button"
              onClick={() => {
                void saveNow();
              }}
              className="px-3.5 py-2 rounded-xl bg-[#B42318] text-white font-bold text-xs cursor-pointer"
            >
              Coba simpan lagi
            </button>
          </div>
        )}

        {/* Banner Jika Tagihan Sudah Final */}
        {isLockedFinal && (
          <div className="p-4 rounded-3xl bg-[#EAF0FA] border border-[#A8C7FA] flex items-center justify-between gap-3">
            <div className="text-xs text-[#17233B]">
              <p className="font-bold">Tagihan ini sudah selesai.</p>
              <p className="text-[#4A5B7C]">
                Tekan Ubah tagihan untuk mengoreksi rincian.
              </p>
            </div>
            <button
              type="button"
              onClick={handleReopenBill}
              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#2855D9] text-white font-bold text-xs shrink-0 cursor-pointer"
            >
              Ubah tagihan
            </button>
          </div>
        )}

        {/* 1. Info Tempat & Tombol Lihat Foto Referensi */}
        <section className={`${ui.panel} space-y-4`}>
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-[#D8E2F2]">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-[#E6EDFF] text-[#2855D9] flex items-center justify-center shrink-0">
                <Store className="w-4 h-4" aria-hidden="true" />
              </span>
              <h2 className={ui.sectionTitle}>Info tagihan</h2>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              <label
                htmlFor="input-bill-title"
                className="text-xs font-semibold text-[#4A5B7C] block mb-1.5"
              >
                Nama tagihan
              </label>
              <input
                id="input-bill-title"
                name="bill-title"
                autoComplete="off"
                maxLength={120}
                type="text"
                disabled={isLockedFinal}
                value={bill.title}
                onChange={(e) =>
                  updateBillState((prev) => ({
                    ...prev,
                    title: e.target.value,
                  }))
                }
                placeholder="Contoh: Makan Siang Tim"
                className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-white border border-[#D8E2F2] text-sm font-bold text-[#17233B] focus:border-[#2855D9] focus:outline-none disabled:bg-[#EAF0FA]"
              />
            </div>
            <div className="min-w-0">
              <label
                htmlFor="input-merchant"
                className="text-xs font-semibold text-[#4A5B7C] block mb-1.5"
              >
                Tempat (opsional)
              </label>
              <input
                id="input-merchant"
                name="merchant"
                autoComplete="off"
                maxLength={120}
                type="text"
                disabled={isLockedFinal}
                value={bill.merchant}
                onChange={(e) =>
                  updateBillState((prev) => ({
                    ...prev,
                    merchant: e.target.value,
                  }))
                }
                placeholder="Contoh: Bakmi Menteng"
                className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-white border border-[#D8E2F2] text-sm font-semibold text-[#17233B] focus:border-[#2855D9] focus:outline-none disabled:bg-[#EAF0FA]"
              />
            </div>
          </div>
        </section>

        {/* 2. Daftar Item Pesanan */}
        <section
          aria-labelledby="heading-daftar-item"
          className={`${ui.panel} space-y-4`}
        >
          <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-[#D8E2F2]">
            <div className="flex items-start gap-2.5">
              <span className="w-7 h-7 rounded-lg bg-[#E6EDFF] text-[#2855D9] flex items-center justify-center shrink-0 mt-0.5">
                <ReceiptText className="w-4 h-4" aria-hidden="true" />
              </span>
              <div>
                <h2 id="heading-daftar-item" className={ui.sectionTitle}>
                  Pesanan ({bill.items.length})
                </h2>
                <p className="text-xs text-[#4A5B7C]">
                  Cek nama, jumlah, dan total harga tiap pesanan.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {bill.items.map((item, idx) => {
              const isExpanded = Boolean(expandedItemDetails[item.id]);
              const hasUnitMismatch = hasUnitPriceMismatch(item);
              const itemFeedback = receiptItemFeedback(item);

              return (
                <div
                  key={item.id}
                  className={`rounded-2xl border p-3.5 space-y-3 transition-colors focus-within:border-[#9DC0FB] focus-within:bg-white ${
                    itemFeedback.length > 0
                      ? "bg-[#FFF3E6]/60 border-[#F5CA86]"
                      : "bg-[#F4F7FC] border-[#D8E2F2]"
                  }`}
                >
                  {/* Header Kartu Item: Nomor Menu & Tombol Hapus */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-white border border-[#D8E2F2] text-[11px] font-extrabold text-[#17233B]">
                      <ReceiptText
                        className="w-3 h-3 text-[#2855D9]"
                        aria-hidden="true"
                      />
                      Pesanan #{idx + 1}
                    </span>

                    <button
                      type="button"
                      disabled={isLockedFinal || bill.items.length <= 1}
                      onClick={() => handleRemoveItem(item.id)}
                      className="min-h-[44px] px-2.5 py-1 rounded-xl bg-white hover:bg-[#FDECEC] border border-[#D8E2F2] text-xs font-semibold text-[#7687A6] hover:text-[#B42318] inline-flex items-center gap-1 disabled:opacity-40 cursor-pointer transition-colors"
                      aria-label={`Hapus ${item.name || `pesanan ${idx + 1}`}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Hapus</span>
                    </button>
                  </div>

                  <ReceiptItemNotice
                    item={item}
                    items={bill.items}
                    locked={isLockedFinal}
                    onChange={(updated) => updateBillState(prev => ({ ...prev, items: prev.items.map(it => it.id === item.id ? updated : it) }))}
                    onMerge={(parentId) => handleMergeItem(item.id, parentId)}
                  />
                  {item.includedModifiers?.length ? (
                    <p className="text-xs text-[#4A5B7C]">Sudah termasuk: {item.includedModifiers.join(", ")}</p>
                  ) : null}
                  {item.baseUnitPrice != null && (
                    <p className="text-xs text-[#4A5B7C]">Harga dasar di struk: {formatRupiah(item.baseUnitPrice)}. Totalnya sudah termasuk tambahan.</p>
                  )}

                  {/* Baris 1: Input Nama Menu Full-Width */}
                  <div>
                    <label
                      htmlFor={`item-name-${item.id}`}
                      className="text-xs font-semibold text-[#4A5B7C] block mb-1"
                    >
                      Nama pesanan {idx + 1}
                    </label>
                    <input
                      id={`item-name-${item.id}`}
                      name={`item-name-${item.id}`}
                      autoComplete="off"
                      aria-invalid={!item.name.trim()}
                      maxLength={160}
                      type="text"
                      disabled={isLockedFinal}
                      value={item.name}
                      placeholder="Mis. Nasi goreng"
                      onChange={(e) =>
                        updateBillState((prev) => ({
                          ...prev,
                          items: prev.items.map((it) =>
                            it.id === item.id
                              ? {
                                  ...it,
                                  name: e.target.value,
                                  reviewConfirmed: true,
                                }
                              : it,
                          ),
                        }))
                      }
                      className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-white border border-[#D8E2F2] text-sm font-bold text-[#17233B] focus:border-[#2855D9] focus:outline-none"
                    />
                  </div>

                  {/* Baris 2: Input Kuantitas & Nominal Baris (Mobile Friendly) */}
                  <div className="grid grid-cols-12 gap-2.5 items-end">
                    <div className="col-span-4">
                      <label
                        htmlFor={`item-qty-${item.id}`}
                        className="text-xs font-semibold text-[#4A5B7C] block mb-1"
                      >
                        Jumlah
                      </label>
                      <input
                        id={`item-qty-${item.id}`}
                        type="number"
                        min={1}
                        max={999}
                        disabled={isLockedFinal}
                        value={item.quantity}
                        aria-invalid={needsQuantityReview(item)}
                        aria-describedby={itemFeedback.length ? `item-review-${item.id}` : undefined}
                        onChange={(e) => {
                          const qty = Math.max(
                            1,
                            Number.parseInt(e.target.value || "1", 10) || 1,
                          );
                          updateBillState((prev) => ({
                            ...prev,
                            items: prev.items.map((it) =>
                              it.id === item.id
                                ? {
                                    ...it,
                                    quantity: qty,
                                    quantityStatus: "confirmed",
                                    unitMismatchConfirmed: false,
                                    reviewConfirmed: true,
                                  }
                                : it,
                            ),
                          }));
                        }}
                        className="w-full min-h-[44px] px-2.5 py-2 rounded-xl bg-white border border-[#D8E2F2] text-sm font-bold text-center text-[#17233B] tabular-money focus:border-[#2855D9] focus:outline-none"
                      />
                    </div>

                    <div className="col-span-8">
                      <MoneyInput
                        id={`item-line-${item.id}`}
                        label="Total harga"
                        describedBy={itemFeedback.length ? `item-review-${item.id}` : undefined}
                        disabled={isLockedFinal}
                        value={item.lineAmount}
                        placeholder="Isi total harga"
                        allowNull
                        onChange={(val) =>
                          updateBillState((prev) => ({
                            ...prev,
                            items: prev.items.map((it) =>
                              it.id === item.id
                                ? {
                                    ...it,
                                    lineAmount: val,
                                    unitMismatchConfirmed: false,
                                    reviewConfirmed: true,
                                    ambiguityReason: null,
                                  }
                                : it,
                            ),
                          }))
                        }
                      />
                    </div>
                  </div>

                  {/* Opsi Buka Harga Satuan & Konfirmasi Selisih Harga Satuan */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#D8E2F2]/70">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedItemDetails((prev) => ({
                          ...prev,
                          [item.id]: !prev[item.id],
                        }))
                      }
                      className="text-xs font-semibold text-[#4A5B7C] hover:text-[#17233B] inline-flex items-center gap-1 cursor-pointer"
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp
                            className="w-3.5 h-3.5"
                            aria-hidden="true"
                          />{" "}
                          Sembunyikan harga satuan
                        </>
                      ) : (
                        <>
                          <ChevronDown
                            className="w-3.5 h-3.5"
                            aria-hidden="true"
                          />{" "}
                          Harga satuan{" "}
                          {item.unitPrice
                            ? `(${formatRupiah(item.unitPrice)})`
                            : "(opsional)"}
                        </>
                      )}
                    </button>

                    {hasUnitMismatch && item.unitMismatchConfirmed && (
                      <span className="text-xs text-[#146346]">Menggunakan total {formatRupiah(item.lineAmount)} sesuai pilihanmu.</span>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="pt-2 border-t border-[#D8E2F2]">
                      <MoneyInput
                        id={`item-unit-${item.id}`}
                        label="Harga satuan (opsional)"
                        disabled={isLockedFinal}
                        value={item.unitPrice ?? null}
                        allowNull
                        onChange={(val) =>
                          updateBillState((prev) => ({
                            ...prev,
                            items: prev.items.map((it) =>
                              it.id === item.id
                                ? { ...it, unitPrice: val, unitMismatchConfirmed: false, reviewConfirmed: false }
                                : it,
                            ),
                          }))
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {!isLockedFinal && (
            <button
              type="button"
              onClick={handleAddItem}
              className="w-full min-h-[46px] rounded-2xl bg-[#F4F7FC] hover:bg-[#EAF0FA] border border-dashed border-[#A8C7FA] text-[#2855D9] font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Tambah pesanan
            </button>
          )}
        </section>

        {/* 3. Area Komponen Biaya: Diskon, Service, Pajak, Pembulatan */}
        <section
          aria-labelledby="heading-komponen-biaya"
          className={`${ui.panel} space-y-4`}
        >
          <div className="flex items-start gap-2.5 pb-2.5 border-b border-[#D8E2F2]">
            <span className="w-7 h-7 rounded-lg bg-[#E6EDFF] text-[#2855D9] flex items-center justify-center shrink-0 mt-0.5">
              <Percent className="w-4 h-4" aria-hidden="true" />
            </span>
            <div>
              <h2 id="heading-komponen-biaya" className={ui.sectionTitle}>
                Pajak, biaya, dan diskon
              </h2>
              <p className="text-xs text-[#4A5B7C]">
                Biaya dan diskon dibagi sesuai nilai pesanan masing-masing
                teman.
              </p>
            </div>
          </div>

          {bill.adjustments.length === 0 ? (
            <div className="text-xs text-[#4A5B7C] bg-[#F4F7FC] border border-dashed border-[#D8E2F2] rounded-2xl p-3.5 text-center">
              Tambahkan pajak, biaya, atau diskon jika ada di struk.
            </div>
          ) : (
            <div className="space-y-3">
              {bill.adjustments.map((adj) => {
                const discountedItem = adj.kind === "item-discount" && adj.eligibleItemIds.length === 1
                  ? bill.items.find(item => item.id === adj.eligibleItemIds[0]) : null;
                const isPartialScope =
                  adj.eligibleItemIds.length < bill.items.length;
                const availableServices = bill.adjustments.filter(
                  (other) =>
                    other.id !== adj.id &&
                    other.kind === "service" &&
                    other.mode === "added",
                );

                return (
                  <div
                    key={adj.id}
                    className="rounded-2xl bg-[#F4F7FC] border border-[#D8E2F2] p-3.5 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#E6EDFF] text-[#1E44B8] uppercase">
                          {adj.kind === "bill-discount" ||
                          adj.kind === "item-discount"
                            ? "Diskon"
                            : adj.kind === "service"
                              ? "Biaya layanan"
                              : adj.kind === "tax"
                                ? "Pajak"
                                : adj.kind === "rounding"
                                  ? "Pembulatan"
                                  : "Biaya"}
                        </span>
                        {receiptAdjustmentLabel(adj) && (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-[#E6F5EF] text-[#146346]">
                            {receiptAdjustmentLabel(adj)}
                          </span>
                        )}
                      </div>

                      {!isLockedFinal && (
                        <button
                          type="button"
                          onClick={() =>
                            updateBillState((prev) => ({
                              ...prev,
                              adjustments: prev.adjustments.filter(
                                (a) => a.id !== adj.id,
                              ),
                            }))
                          }
                          className="min-h-[44px] px-2.5 py-1 rounded-xl bg-white border border-[#D8E2F2] text-xs font-semibold text-[#B42318] hover:bg-[#FDECEC] inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          Hapus
                        </button>
                      )}
                    </div>

                    {discountedItem && <p className="text-xs text-[#4A5B7C]">Untuk {discountedItem.name}</p>}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label
                          htmlFor={`adj-name-${adj.id}`}
                          className="text-xs font-semibold text-[#4A5B7C] block mb-1"
                        >
                          {adj.kind.endsWith("discount") ? "Nama diskon" : "Nama biaya"}
                        </label>
                        <input
                          id={`adj-name-${adj.id}`}
                          type="text"
                          disabled={isLockedFinal}
                          value={adj.name}
                          onChange={(e) =>
                            updateBillState((prev) => ({
                              ...prev,
                              adjustments: prev.adjustments.map((a) =>
                                a.id === adj.id
                                  ? {
                                      ...a,
                                      name: e.target.value,
                                      reviewConfirmed: true,
                                    }
                                  : a,
                              ),
                            }))
                          }
                          className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-white border border-[#D8E2F2] text-sm font-bold text-[#17233B]"
                        />
                      </div>

                      {adj.amountSource === "observed" ? (
                        <MoneyInput
                          id={`adj-amt-${adj.id}`}
                          label={adj.kind.endsWith("discount") ? "Potongan harga" : "Jumlah pada struk"}
                          disabled={isLockedFinal}
                          value={adj.amount}
                          allowNull
                          onChange={(val) =>
                            updateBillState((prev) => ({
                              ...prev,
                              adjustments: prev.adjustments.map((a) =>
                                a.id === adj.id
                                  ? {
                                      ...a,
                                      amount: val,
                                      reviewConfirmed: true,
                                    }
                                  : a,
                              ),
                            }))
                          }
                        />
                      ) : (
                        <div>
                          <label
                            htmlFor={`adj-rate-${adj.id}`}
                            className="text-xs font-semibold text-[#4A5B7C] block mb-1"
                          >
                            Persentase (%)
                          </label>
                          <input
                            id={`adj-rate-${adj.id}`}
                            type="number"
                            step="0.1"
                            min={0}
                            max={100}
                            disabled={isLockedFinal}
                            value={((adj.rateBps ?? 0) / 100).toString()}
                            onChange={(e) => {
                              const pct = Number.parseFloat(
                                e.target.value || "0",
                              );
                              const bps = Math.max(0, Math.round(pct * 100));
                              updateBillState((prev) => ({
                                ...prev,
                                adjustments: prev.adjustments.map((a) =>
                                  a.id === adj.id
                                    ? {
                                        ...a,
                                        rateBps: bps,
                                        reviewConfirmed: true,
                                      }
                                    : a,
                                ),
                              }));
                            }}
                            className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-white border border-[#D8E2F2] text-sm font-bold text-[#17233B] tabular-money"
                          />
                        </div>
                      )}
                    </div>

                    <DiscountTreatmentNotice adjustment={adj} locked={isLockedFinal}
                      onSubtract={() => updateBillState(prev => ({ ...prev, adjustments: prev.adjustments.map(a => a.id === adj.id
                        ? { ...a, mode: "added", discountNeedsReview: false, reviewConfirmed: true } : a) }))}
                      onAlreadyIncluded={() => updateBillState(prev => ({ ...prev, adjustments: prev.adjustments.filter(a => a.id !== adj.id) }))}
                    />
                    {adj.basisNeedsReview && (
                      <label className="block text-xs text-[#9A4A12] space-y-1">
                        <span>Dasar perhitungan belum jelas. Pilih sesuai struk.</span>
                        <select aria-label={`Dasar perhitungan ${adj.name}`} value="" disabled={isLockedFinal}
                          onChange={event => {
                            const basis = event.target.value;
                            if (basis !== "gross" && basis !== "net") return;
                            updateBillState(prev => ({ ...prev, adjustments: prev.adjustments.map(a => a.id === adj.id ? { ...a, basis, basisNeedsReview: false } : a) }));
                          }} className="block w-full min-h-[44px] rounded-xl border border-[#E8CB83] bg-white px-3">
                          <option value="">Pilih dasar hitung</option>
                          <option value="gross">Harga sebelum diskon</option>
                          <option value="net">Harga setelah diskon</option>
                        </select>
                      </label>
                    )}
                    {!adj.scopeConfirmed && adj.kind !== "rounding" && (
                      <div className="rounded-xl bg-[#FFF3E6] p-3 space-y-2 text-xs text-[#9A4A12]">
                        <p>Periksa pesanan yang mendapat {adj.name}. Ubah daftar di bawah jika hanya berlaku untuk sebagian pesanan.</p>
                        <button type="button" disabled={isLockedFinal} className="min-h-[44px] rounded-xl border border-[#E8CB83] bg-white px-3 font-bold"
                          onClick={() => updateBillState(prev => ({ ...prev, adjustments: prev.adjustments.map(a => a.id === adj.id ? { ...a, scopeConfirmed: true } : a) }))}>
                          {isPartialScope ? "Pilihan pesanan sudah sesuai" : "Benar, berlaku untuk semua pesanan"}
                        </button>
                      </div>
                    )}
                    {/* Opsi Tambahan untuk Pajak / Pembulatan / Scope Item */}
                    <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-[#4A5B7C]">
                      {adj.kind === "tax" && (
                        <label className="inline-flex items-center gap-1.5 font-semibold text-[#17233B] cursor-pointer">
                          <input
                            type="checkbox"
                            disabled={isLockedFinal}
                            checked={adj.mode === "included"}
                            onChange={(e) =>
                              updateBillState((prev) => ({
                                ...prev,
                                adjustments: prev.adjustments.map((a) =>
                                  a.id === adj.id
                                    ? {
                                        ...a,
                                        mode: e.target.checked
                                          ? "included"
                                          : "added",
                                      }
                                    : a,
                                ),
                              }))
                            }
                          />
                          Pajak sudah termasuk dalam harga pesanan
                        </label>
                      )}

                      {adj.kind === "tax" &&
                        adj.mode === "added" &&
                        availableServices.length > 0 && (
                          <label className="inline-flex items-center gap-1.5 font-semibold text-[#17233B] cursor-pointer">
                            <input
                              type="checkbox"
                              disabled={isLockedFinal}
                              checked={
                                (adj.dependsOnAdjustmentIds ?? []).length > 0
                              }
                              onChange={(e) =>
                                updateBillState((prev) => ({
                                  ...prev,
                                  adjustments: prev.adjustments.map((a) =>
                                    a.id === adj.id
                                      ? {
                                          ...a,
                                          dependsOnAdjustmentIds: e.target
                                            .checked
                                            ? availableServices.map((s) => s.id)
                                            : [],
                                        }
                                      : a,
                                  ),
                                }))
                              }
                            />
                            Pajak juga dihitung dari biaya layanan
                          </label>
                        )}

                      {adj.kind === "rounding" && (
                        <div className="inline-flex items-center gap-2">
                          <span className="font-semibold">Pembulatan ini:</span>
                          <button
                            type="button"
                            disabled={isLockedFinal}
                            onClick={() =>
                              updateBillState((prev) => ({
                                ...prev,
                                adjustments: prev.adjustments.map((a) =>
                                  a.id === adj.id
                                    ? { ...a, sign: "positive", directionNeedsReview: false }
                                    : a,
                                ),
                              }))
                            }
                            className={`px-2.5 py-1 rounded-lg font-bold ${
                              adj.sign === "positive" && !adj.directionNeedsReview
                                ? "bg-[#2855D9] text-white"
                                : "bg-white border border-[#D8E2F2]"
                            }`}
                          >
                            + Menambah
                          </button>
                          <button
                            type="button"
                            disabled={isLockedFinal}
                            onClick={() =>
                              updateBillState((prev) => ({
                                ...prev,
                                adjustments: prev.adjustments.map((a) =>
                                  a.id === adj.id
                                    ? { ...a, sign: "negative", directionNeedsReview: false }
                                    : a,
                                ),
                              }))
                            }
                            className={`px-2.5 py-1 rounded-lg font-bold ${
                              adj.sign === "negative" && !adj.directionNeedsReview
                                ? "bg-[#2855D9] text-white"
                                : "bg-white border border-[#D8E2F2]"
                            }`}
                          >
                            - Mengurangi
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Pilihan Scope Item Parsial (bila sebagian menu bebas pajak/diskon) */}
                    {adj.kind !== "rounding" && bill.items.length > 1 && (
                      <details className="pt-2 border-t border-[#D8E2F2] space-y-1.5">
                        <summary className="min-h-[44px] flex items-center cursor-pointer text-xs font-bold text-[#2855D9]">
                          {isPartialScope
                            ? `Berlaku untuk ${adj.eligibleItemIds.length} pesanan`
                            : "Berlaku untuk semua pesanan"}{" "}
                          (ubah)
                        </summary>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-[#4A5B7C]">
                            Berlaku untuk pesanan (
                            {isPartialScope
                              ? `${adj.eligibleItemIds.length} dari ${bill.items.length} pesanan`
                              : "Semua pesanan"}
                            ):
                          </span>
                          {!isLockedFinal && isPartialScope && (
                            <button
                              type="button"
                              onClick={() =>
                                updateBillState((prev) => ({
                                  ...prev,
                                  adjustments: prev.adjustments.map((a) =>
                                    a.id === adj.id
                                      ? {
                                          ...a,
                                          eligibleItemIds: prev.items.map(
                                            (i) => i.id,
                                          ),
                                          scopeConfirmed: true,
                                        }
                                      : a,
                                  ),
                                }))
                              }
                              className="font-bold text-[#2855D9] hover:underline cursor-pointer"
                            >
                              Pilih semua pesanan
                            </button>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {bill.items.map((it) => {
                            const checked = adj.eligibleItemIds.includes(it.id);
                            return (
                              <button
                                key={it.id}
                                type="button"
                                disabled={isLockedFinal}
                                onClick={() => {
                                  const nextIds = checked
                                    ? adj.eligibleItemIds.filter(
                                        (id) => id !== it.id,
                                      )
                                    : [...adj.eligibleItemIds, it.id];
                                  if (nextIds.length === 0) return;
                                  updateBillState((prev) => ({
                                    ...prev,
                                    adjustments: prev.adjustments.map((a) =>
                                      a.id === adj.id
                                        ? {
                                            ...a,
                                            eligibleItemIds: nextIds,
                                            scopeConfirmed: true,
                                            reviewConfirmed: true,
                                          }
                                        : a,
                                    ),
                                  }));
                                }}
                                className={`min-w-0 max-w-full break-all text-left px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                                  checked
                                    ? "bg-[#E6EDFF] border-[#2855D9] text-[#1E44B8]"
                                    : "bg-white border-[#D8E2F2] text-[#7687A6]"
                                }`}
                              >
                                {checked && (
                                  <Check
                                    className="inline w-3.5 h-3.5 mr-1"
                                    aria-hidden="true"
                                  />
                                )}
                                {it.name}
                              </button>
                            );
                          })}
                        </div>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!isLockedFinal && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleAddAdjustmentPreset("service")}
                className="min-h-[42px] px-3 py-2 rounded-xl bg-[#F4F7FC] hover:bg-[#EAF0FA] border border-[#D8E2F2] text-xs font-bold text-[#17233B] inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Plus
                  className="w-3.5 h-3.5 text-[#2855D9] shrink-0"
                  aria-hidden="true"
                />{" "}
                Biaya layanan
              </button>
              <button
                type="button"
                onClick={() => handleAddAdjustmentPreset("tax")}
                className="min-h-[42px] px-3 py-2 rounded-xl bg-[#F4F7FC] hover:bg-[#EAF0FA] border border-[#D8E2F2] text-xs font-bold text-[#17233B] inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Plus
                  className="w-3.5 h-3.5 text-[#2855D9] shrink-0"
                  aria-hidden="true"
                />{" "}
                Pajak
              </button>
              <button
                type="button"
                onClick={() => handleAddAdjustmentPreset("bill-discount")}
                className="min-h-[42px] px-3 py-2 rounded-xl bg-[#F4F7FC] hover:bg-[#EAF0FA] border border-[#D8E2F2] text-xs font-bold text-[#17233B] inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Plus
                  className="w-3.5 h-3.5 text-[#2855D9] shrink-0"
                  aria-hidden="true"
                />{" "}
                Diskon
              </button>
              <button
                type="button"
                onClick={() => handleAddAdjustmentPreset("rounding")}
                className="min-h-[42px] px-3 py-2 rounded-xl bg-[#F4F7FC] hover:bg-[#EAF0FA] border border-[#D8E2F2] text-xs font-bold text-[#17233B] inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Plus
                  className="w-3.5 h-3.5 text-[#2855D9] shrink-0"
                  aria-hidden="true"
                />{" "}
                Pembulatan
              </button>
            </div>
          )}
        </section>

        {/* 4. Rekonsiliasi Total Struk */}
        <section
          aria-labelledby="heading-rekonsiliasi"
          className={`${ui.panel} space-y-4`}
        >
          <div className="flex items-start gap-2.5 pb-2.5 border-b border-[#D8E2F2]">
            <span className="w-7 h-7 rounded-lg bg-[#E6EDFF] text-[#2855D9] flex items-center justify-center shrink-0 mt-0.5">
              <Calculator className="w-4 h-4" aria-hidden="true" />
            </span>
            <div>
              <h2 id="heading-rekonsiliasi" className={ui.sectionTitle}>
                Cek total tagihan
              </h2>
              <p className="text-xs text-[#4A5B7C]">
                Pastikan jumlah rincian di bawah sama dengan total akhir struk.
              </p>
            </div>
          </div>

          <div className="space-y-2 text-xs text-[#4A5B7C] bg-[#F4F7FC] p-3.5 rounded-2xl border border-[#D8E2F2]">
            <div className="flex justify-between">
              <span>Subtotal pesanan ({bill.items.length} pesanan)</span>
              <span className="font-bold text-[#17233B] tabular-money">
                {hasMissingAmounts
                  ? "Belum lengkap"
                  : formatRupiah(calc.computedItemsSubtotal)}
              </span>
            </div>
            {calc.computedDiscountsTotal > 0 && (
              <div className="flex justify-between text-[#146346]">
                <span>Total diskon</span>
                <span className="font-bold tabular-money">
                  -{formatRupiah(calc.computedDiscountsTotal)}
                </span>
              </div>
            )}
            {calc.computedAddedChargesTotal > 0 && (
              <div className="flex justify-between">
                <span>Pajak dan biaya layanan</span>
                <span className="font-bold text-[#17233B] tabular-money">
                  +{formatRupiah(calc.computedAddedChargesTotal)}
                </span>
              </div>
            )}
            {calc.computedRoundingSignedTotal !== 0 && (
              <div className="flex justify-between">
                <span>Pembulatan</span>
                <span className="font-bold text-[#17233B] tabular-money">
                  {calc.computedRoundingSignedTotal > 0 ? "+" : ""}
                  {formatRupiah(calc.computedRoundingSignedTotal)}
                </span>
              </div>
            )}
            <div className="pt-2.5 border-t border-dashed border-[#CBD8EE] flex justify-between text-sm font-extrabold text-[#17233B]">
              <span>Total pesanan dan biaya</span>
              <span className="tabular-money">
                {hasMissingAmounts
                  ? "Belum lengkap"
                  : formatRupiah(calc.computedGrandTotal)}
              </span>
            </div>
          </div>

          <div className="pt-1">
            <MoneyInput
              id="input-confirmed-grand-total"
              label="Total akhir di struk"
              disabled={isLockedFinal}
              value={bill.confirmedGrandTotal}
              allowNull
              onChange={(val) =>
                updateBillState((prev) => ({
                  ...prev,
                  confirmedGrandTotal: val,
                }))
              }
            />
            {bill.observedGrandTotal != null && (
              <p className="mt-2 text-xs text-[#4A5B7C]">Total dari scan: {formatRupiah(bill.observedGrandTotal)}. Koreksi hanya jika berbeda dari struk.</p>
            )}
          </div>

          {/* Status Kecocokan */}
          {hasMissingAmounts ? (
            <div className="p-3.5 rounded-2xl bg-[#FFF3E6] border border-[#F5CA86] text-xs font-bold text-[#9A4A12] flex items-center gap-2">
              <Calculator className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Lengkapi harga yang kosong agar totalnya bisa dicek.</span>
            </div>
          ) : calc.grandTotalDifference === 0 ? (
            <div className="p-3.5 rounded-2xl bg-[#E6F5EF] border border-[#9ADBC3] text-xs font-bold text-[#146346] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>
                Totalnya sesuai struk ({formatRupiah(calc.computedGrandTotal)}).
              </span>
            </div>
          ) : (
            <div className="p-3.5 rounded-2xl bg-[#FFF3E6] border border-[#F5CA86] text-xs text-[#9A4A12] space-y-2.5">
              <div className="flex items-start gap-2 font-bold">
                <AlertTriangle
                  className="w-4 h-4 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <span>
                  {calc.grandTotalDifference === null
                    ? "Isi total akhir di struk terlebih dahulu."
                    : calc.grandTotalDifference < 0
                      ? `Jumlah rincian lebih kecil ${formatRupiah(
                          Math.abs(calc.grandTotalDifference),
                        )} dari total struk.`
                      : `Jumlah rincian lebih besar ${formatRupiah(
                          Math.abs(calc.grandTotalDifference),
                        )} dari total struk.`}
                </span>
              </div>
              <p>Periksa pesanan, topping, pajak, dan diskon. Tambahkan pembulatan hanya jika tercantum di struk.</p>
            </div>
          )}
        </section>
        {!hasMissingAmounts &&
          bill.items.every((item) => item.name.trim()) &&
          reviewIssues.some((issue) => issue.severity === "error") && (
            <aside className={ui.notice} aria-label="Rincian yang perlu dicek">
              <h2 className="font-bold text-[#17233B]">
                Periksa sebelum lanjut
              </h2>
              <ul className="list-disc pl-5 mt-2 space-y-1">
                {reviewIssues
                  .filter((issue) => issue.severity === "error")
                  .map((issue, index) => (
                    <li key={issue.code + index}>
                      {billingIssueMessage(issue, bill)}
                    </li>
                  ))}
              </ul>
            </aside>
          )}
        </fieldset>
      </main>

      <ActionBar
        title={
          hasMissingAmounts
            ? "Lengkapi harga pesanan"
            : bill.items.some((item) => !item.name.trim())
              ? "Isi nama pesanan"
              : reviewIssues.some((issue) => issue.severity === "error")
                ? "Periksa rincian dulu"
                : "Total sudah sesuai"
        }
        detail={
          hasMissingAmounts
            ? "Ada harga yang belum diisi"
            : formatRupiah(calc.computedGrandTotal)
        }
        label="Lanjut bagi pesanan"
        pendingLabel={photoBusy ? "Menunggu foto…" : "Menyimpan…"}
        pending={proceedPending || photoBusy}
        disabled={
          photoBusy || hasMissingAmounts ||
          bill.items.some((item) => !item.name.trim()) ||
          reviewIssues.some((issue) => issue.severity === "error")
        }
        onClick={handleSaveAndProceedToSplit}
      />
    </div>
  );
}
