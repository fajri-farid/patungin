"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  HandPlatter,
  Minus,
  Plus,
  UserPlus,
  Users,
  Wallet,
  X,
} from "lucide-react";
import {
  calculateBill,
  calculateBillForReview,
} from "@/domain/billing/calculation";
import { ActionBar } from "@/components/product/ActionBar";
import ui from "@/components/product/product.module.css";
import { formatRupiah } from "@/domain/billing/money";
import {
  MAX_PARTICIPANTS_COUNT,
  type AllocationMode,
  type BillDocument,
  type BillItem,
  type ItemAllocation,
  type Participant,
} from "@/domain/billing/types";
import { buildParticipantVisualMap } from "@/lib/palette";
import {
  ParticipantAvatar,
  ParticipantChip,
} from "@/components/ParticipantBadge";
import { StepIntro, StepHeader } from "@/components/StepHeader";
import { useBillDraft } from "@/components/useBillDraft";

interface SplitClientProps {
  initialBill: BillDocument;
}

function isItemFullyAllocated(
  item: BillItem,
  alloc: ItemAllocation | undefined,
  validParticipantIds: Set<string>,
): boolean {
  if (!alloc) return false;
  if (alloc.mode === "units") {
    let sum = 0;
    for (const [pid, count] of Object.entries(alloc.unitCounts ?? {})) {
      if (!validParticipantIds.has(pid)) return false;
      if (!Number.isSafeInteger(count) || count < 0) return false;
      sum += count;
    }
    return sum === item.quantity;
  }
  if (alloc.mode === "shared") {
    const ids = (alloc.participantIds ?? []).filter((id) =>
      validParticipantIds.has(id),
    );
    return ids.length > 0 && ids.length === (alloc.participantIds ?? []).length;
  }
  return false;
}

export function SplitClient({ initialBill }: SplitClientProps) {
  const router = useRouter();
  const { bill, saveStatus, saveError, updateBillState, saveNow } =
    useBillDraft(initialBill, (current) => ({
      participants: current.participants,
      payerParticipantId: current.payerParticipantId,
      allocations: current.allocations,
    }));

  const [proceedPending, setProceedPending] = useState(false);
  const [newParticipantName, setNewParticipantName] = useState("");
  const [newParticipantLabel, setNewParticipantLabel] = useState("");
  const [showPayerSelector, setShowPayerSelector] = useState(false);
  const [filterMode, setFilterMode] = useState<"all" | "unallocated">("all");
  const [activeSheetItemId, setActiveSheetItemId] = useState<string | null>(
    null,
  );

  const participantSeqRef = useRef<number>(100);

  const isLockedFinal = bill.status === "finalized";

  const visualMap = useMemo(
    () => buildParticipantVisualMap(bill.participants),
    [bill.participants],
  );

  const validParticipantIds = useMemo(
    () => new Set(bill.participants.map((p) => p.id)),
    [bill.participants],
  );

  const calc = useMemo(
    () =>
      calculateBill({
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

  const receiptTotal = useMemo(
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
      }).computedGrandTotal,
    [bill],
  );

  const allocationByItemId = useMemo(
    () => new Map(bill.allocations.map((a) => [a.itemId, a])),
    [bill.allocations],
  );

  const unallocatedItems = useMemo(
    () =>
      bill.items.filter(
        (it) =>
          !isItemFullyAllocated(
            it,
            allocationByItemId.get(it.id),
            validParticipantIds,
          ),
      ),
    [bill.items, allocationByItemId, validParticipantIds],
  );

  const filteredItems =
    filterMode === "unallocated" ? unallocatedItems : bill.items;

  const allocatedCount = bill.items.length - unallocatedItems.length;
  const progressPct =
    bill.items.length > 0
      ? Math.round((allocatedCount / bill.items.length) * 100)
      : 100;

  // Tutup bottom sheet dengan tombol Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveSheetItemId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!activeSheetItemId) return;
    const previous = document.activeElement as HTMLElement | null;
    const sheet = document.querySelector<HTMLElement>('[role="dialog"]');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        sheet?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
        ) ?? [],
      );
    focusable()[0]?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trapFocus);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", trapFocus);
      previous?.focus();
    };
  }, [activeSheetItemId]);

  const handleAddParticipant = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newParticipantName.trim();
    if (!trimmed || bill.participants.length >= MAX_PARTICIPANTS_COUNT) return;

    const nextOrder =
      bill.participants.reduce(
        (max, p) => Math.max(max, p.allocationOrder),
        -1,
      ) + 1;
    participantSeqRef.current += 1;
    const newParticipant: Participant = {
      id: `p_${nextOrder}_${participantSeqRef.current}`,
      allocationOrder: nextOrder,
      name: trimmed.slice(0, 40),
      label: newParticipantLabel.trim()
        ? newParticipantLabel.trim().slice(0, 25)
        : undefined,
    };

    setNewParticipantName("");
    setNewParticipantLabel("");

    updateBillState((prev) => ({
      ...prev,
      participants: [...prev.participants, newParticipant],
      payerParticipantId: prev.payerParticipantId ?? newParticipant.id,
    }));
  };

  const handleRemoveParticipant = (participantId: string) => {
    if (bill.participants.length <= 1) return;
    const target = bill.participants.find((p) => p.id === participantId);
    if (
      !window.confirm(
        `Hapus "${target?.name}" dari daftar peserta? Pesanan yang sebelumnya dipilih untuk ${target?.name} perlu dibagi ulang.`,
      )
    ) {
      return;
    }

    updateBillState((prev) => {
      const remaining = prev.participants.filter((p) => p.id !== participantId);
      const nextPayer =
        prev.payerParticipantId === participantId
          ? (remaining[0]?.id ?? null)
          : prev.payerParticipantId;

      const cleanedAllocations = prev.allocations.map((alloc) => {
        if (alloc.mode === "units") {
          const nextCounts = { ...(alloc.unitCounts ?? {}) };
          delete nextCounts[participantId];
          return { ...alloc, unitCounts: nextCounts };
        }
        return {
          ...alloc,
          participantIds: (alloc.participantIds ?? []).filter(
            (id) => id !== participantId,
          ),
        };
      });

      return {
        ...prev,
        participants: remaining,
        payerParticipantId: nextPayer,
        allocations: cleanedAllocations,
      };
    });
  };

  const setItemAllocation = (itemId: string, nextAlloc: ItemAllocation) => {
    updateBillState((prev) => {
      const exists = prev.allocations.some((a) => a.itemId === itemId);
      const nextAllocations = exists
        ? prev.allocations.map((a) => (a.itemId === itemId ? nextAlloc : a))
        : [...prev.allocations, nextAlloc];
      return {
        ...prev,
        allocations: nextAllocations,
      };
    });
  };

  const activeSheetItem = activeSheetItemId
    ? (bill.items.find((i) => i.id === activeSheetItemId) ?? null)
    : null;
  const activeSheetAlloc = activeSheetItem
    ? (allocationByItemId.get(activeSheetItem.id) ?? {
        itemId: activeSheetItem.id,
        mode: "units" as AllocationMode,
        unitCounts: {},
      })
    : null;

  const payerIdentity = bill.payerParticipantId
    ? visualMap[bill.payerParticipantId]
    : undefined;

  const handleProceedToResult = async () => {
    if (proceedPending) return;
    if (unallocatedItems.length > 0) {
      setFilterMode("unallocated");
      return;
    }
    setProceedPending(true);
    if (await saveNow()) router.push(`/bills/${bill.id}/result`);
    else setProceedPending(false);
  };

  const shareAllEqually = () => {
    if (
      bill.allocations.some(
        (allocation) =>
          allocation.mode === "shared" ||
          Object.values(allocation.unitCounts ?? {}).some((count) => count > 0),
      ) &&
      !window.confirm(
        "Bagi semua pesanan sama rata ke semua teman? Pembagian sebelumnya akan diganti.",
      )
    )
      return;
    updateBillState((current) => ({
      ...current,
      allocations: current.items.map((item) => ({
        itemId: item.id,
        mode: "shared",
        participantIds: current.participants.map((person) => person.id),
      })),
    }));
  };

  const hasDuplicateInputName = bill.participants.some(
    (person) =>
      person.name.toLowerCase() === newParticipantName.trim().toLowerCase(),
  );

  return (
    <div className={`${ui.page} pb-36`}>
      <StepHeader
        billId={bill.id}
        title={bill.title}
        merchant={bill.merchant}
        activeStep="split"
        saveStatus={saveStatus}
        onRetrySave={() => {
          void saveNow();
        }}
        onBeforeNavigate={async () => Boolean(await saveNow())}
      />

      <main id="bill-content" tabIndex={-1} className={ui.main}>
        <fieldset disabled={proceedPending} className="contents">
        <StepIntro activeStep="split" />
        {saveError && (
          <p
            role="alert"
            className="p-3.5 rounded-2xl bg-[#FDECEC] border border-[#F5B5B5] text-xs font-bold text-[#B42318]"
          >
            {saveError}
          </p>
        )}
        {isLockedFinal && (
          <p className="p-3.5 rounded-2xl bg-[#E6EDFF] border border-[#A8C7FA] text-xs font-bold text-[#1E44B8]">
            Tagihan sudah selesai. Buka halaman hasil untuk mengubahnya.
          </p>
        )}

        {/* Bagian 1: Daftar Peserta & Penentuan Pembayar */}
        <section
          aria-labelledby="heading-peserta"
          className={`${ui.panel} space-y-4`}
        >
          <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-[#D8E2F2]">
            <div className="flex items-start gap-2.5">
              <span className="w-7 h-7 rounded-lg bg-[#E6EDFF] text-[#2855D9] flex items-center justify-center shrink-0 mt-0.5">
                <Users className="w-4 h-4" aria-hidden="true" />
              </span>
              <div>
                <h2 id="heading-peserta" className={ui.sectionTitle}>
                  Siapa saja yang ikut? ({bill.participants.length})
                </h2>
                <p className="text-xs text-[#4A5B7C]">
                  Pakai nama panggilan saja.
                </p>
              </div>
            </div>
          </div>

          {/* Form Tambah Peserta (Inline Mobile-Friendly) */}
          {!isLockedFinal &&
            bill.participants.length < MAX_PARTICIPANTS_COUNT && (
              <form onSubmit={handleAddParticipant} className="space-y-2">
                <label
                  className="block text-sm font-semibold text-[#4A5B7C]"
                  htmlFor="new-participant-name"
                >
                  Nama teman
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="new-participant-name"
                    type="text"
                    name="participant-name"
                    autoComplete="off"
                    maxLength={40}
                    value={newParticipantName}
                    onChange={(e) => setNewParticipantName(e.target.value)}
                    placeholder="Mis. Dito"
                    aria-label="Nama panggilan teman baru"
                    className="flex-1 min-w-0 min-h-[44px] px-3.5 py-2 rounded-xl bg-[#F4F7FC] border border-[#D8E2F2] text-sm font-semibold text-[#17233B] focus:bg-white focus:border-[#2855D9] focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="min-h-[44px] px-4 py-2 rounded-xl bg-[#2855D9] hover:bg-[#1E44B8] text-white font-bold text-xs inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer shadow-2xs transition-colors"
                  >
                    <UserPlus className="w-4 h-4" aria-hidden="true" />
                    Tambah teman
                  </button>
                </div>

                {hasDuplicateInputName && (
                  <input
                    type="text"
                    name="participant-label"
                    autoComplete="off"
                    maxLength={25}
                    value={newParticipantLabel}
                    onChange={(e) => setNewParticipantLabel(e.target.value)}
                    placeholder="Pembeda nama, mis. Dito kantor"
                    aria-label="Pembeda nama (opsional)"
                    className="w-full min-h-[40px] px-3 py-1.5 rounded-xl bg-[#FFF3E6]/60 border border-[#F5CA86] text-xs font-medium text-[#17233B] focus:bg-white focus:border-[#2855D9] focus:outline-none"
                  />
                )}
              </form>
            )}

          {/* Wrapper Chip Peserta beserta Total Sementara Masing-masing */}
          <div className="rounded-2xl bg-[#F4F7FC] border border-[#D8E2F2] p-3 space-y-2">
            <p className="text-[11px] font-bold text-[#4A5B7C]">
              Teman yang ikut dan bagian sementara
            </p>
            <div className="flex flex-wrap gap-2">
              {bill.participants.map((p) => {
                const identity = visualMap[p.id];
                const breakdown = calc.participantBreakdowns.find(
                  (b) => b.participantId === p.id,
                );
                if (!identity) return null;

                return (
                  <div
                    key={p.id}
                    className="inline-flex items-center gap-1 bg-white rounded-full p-0.5 pr-1 border border-[#D8E2F2] shadow-2xs"
                  >
                    <ParticipantChip
                      identity={identity}
                      isPayer={p.id === bill.payerParticipantId}
                      suffix={formatRupiah(breakdown?.consumptionTotal ?? 0)}
                    />
                    {!isLockedFinal && bill.participants.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveParticipant(p.id)}
                        className="w-9 h-9 shrink-0 rounded-full bg-[#F4F7FC] hover:bg-[#FDECEC] text-[#7687A6] hover:text-[#B42318] flex items-center justify-center text-xs cursor-pointer transition-colors"
                        aria-label={`Hapus peserta ${p.name}`}
                      >
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Baris Pilih Pembayar / Penalang */}
          <div className="rounded-2xl bg-[#F4F7FC] border border-[#D8E2F2] p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 text-xs">
                <Wallet
                  className="w-4 h-4 text-[#2855D9] shrink-0"
                  aria-hidden="true"
                />
                <span className="text-[#4A5B7C] font-medium">
                  Siapa yang bayar dulu?
                </span>
                <span className="font-extrabold text-[#17233B]">
                  {payerIdentity?.displayLabel ?? "Belum dipilih"}
                </span>
              </div>

              {!isLockedFinal && (
                <button
                  type="button"
                  onClick={() => setShowPayerSelector((v) => !v)}
                  className="min-h-[44px] px-2.5 py-1 rounded-lg bg-white border border-[#D8E2F2] text-xs font-bold text-[#2855D9] hover:bg-[#E6EDFF] cursor-pointer transition-colors"
                >
                  {showPayerSelector ? "Tutup pilihan" : "Ganti pembayar"}
                </button>
              )}
            </div>

            {showPayerSelector && !isLockedFinal && (
              <div className="pt-2.5 border-t border-[#D8E2F2] space-y-2">
                <p className="text-xs font-semibold text-[#4A5B7C]">
                  Ketuk nama orang yang menalangi tagihan di kasir:
                </p>
                <div className="flex flex-wrap gap-2">
                  {bill.participants.map((p) => {
                    const identity = visualMap[p.id];
                    if (!identity) return null;
                    return (
                      <ParticipantChip
                        key={p.id}
                        identity={identity}
                        selected={p.id === bill.payerParticipantId}
                        isPayer={p.id === bill.payerParticipantId}
                        onClick={() => {
                          updateBillState((prev) => ({
                            ...prev,
                            payerParticipantId: p.id,
                          }));
                          setShowPayerSelector(false);
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Bagian 2: Pilih Pemilik Pesanan (Dibungkus dalam Wrapper Utuh & Rapi) */}
        <section
          aria-label="Daftar pesanan untuk dibagi"
          className={`${ui.panel} space-y-4`}
        >
          {/* Header Bagian 2 + Progress Bar */}
          <div className="space-y-3 pb-3 border-b border-[#D8E2F2]">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2.5">
                <span className="w-7 h-7 rounded-lg bg-[#E6EDFF] text-[#2855D9] flex items-center justify-center shrink-0 mt-0.5">
                  <HandPlatter className="w-4 h-4" aria-hidden="true" />
                </span>
                <div>
                  <h2 className={ui.sectionTitle}>Pilih siapa pesan apa</h2>
                  <p className="text-xs text-[#4A5B7C]">
                    Ketuk kartu pesanan di bawah untuk memilih siapa yang pesan.
                  </p>
                </div>
              </div>

              <span
                className={`px-2.5 py-1 rounded-full text-xs font-extrabold tabular-money shrink-0 ${
                  progressPct === 100
                    ? "bg-[#E6F5EF] text-[#146346]"
                    : "bg-[#E6EDFF] text-[#2855D9]"
                }`}
              >
                {progressPct}%
              </span>
            </div>

            {/* Bar Progres Pembagian Pesanan */}
            <div className="rounded-2xl bg-[#F4F7FC] border border-[#D8E2F2] p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-[#17233B] flex items-center gap-1.5">
                  {unallocatedItems.length === 0 ? (
                    <>
                      <CheckCircle2
                        className="w-4 h-4 text-[#146346]"
                        aria-hidden="true"
                      />
                      <span className="text-[#146346]">
                        Semua pesanan sudah dibagi.
                      </span>
                    </>
                  ) : (
                    <>
                      <span>Sudah dibagi</span>
                      <span className="text-[#4A5B7C] font-normal">
                        ({allocatedCount} dari {bill.items.length} pesanan selesai)
                      </span>
                    </>
                  )}
                </span>
              </div>
              <div
                className="w-full bg-[#EAF0FA] h-2 rounded-full overflow-hidden"
                role="progressbar"
                aria-label="Pesanan yang sudah dibagi"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPct}
              >
                <div
                  className={`h-full rounded-full transition-all duration-300 ease-out ${
                    progressPct === 100 ? "bg-[#146346]" : "bg-[#2855D9]"
                  }`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {/* Kontrol Filter & Bagi Rata Semua */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-xl bg-[#F4F7FC] p-1 border border-[#D8E2F2]">
                <button
                  type="button"
                  aria-pressed={filterMode === "all"}
                  onClick={() => setFilterMode("all")}
                  className={`min-h-[44px] px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    filterMode === "all"
                      ? "bg-[#2855D9] text-white shadow-2xs"
                      : "text-[#4A5B7C] hover:text-[#17233B]"
                  }`}
                >
                  Semua pesanan ({bill.items.length})
                </button>
                <button
                  type="button"
                  aria-pressed={filterMode === "unallocated"}
                  onClick={() => setFilterMode("unallocated")}
                  className={`min-h-[44px] px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    filterMode === "unallocated"
                      ? "bg-[#2855D9] text-white shadow-2xs"
                      : "text-[#4A5B7C] hover:text-[#17233B]"
                  }`}
                >
                  Belum dibagi ({unallocatedItems.length})
                </button>
              </div>

              {!isLockedFinal && bill.participants.length > 1 && (
                <button
                  type="button"
                  onClick={shareAllEqually}
                  className="min-h-[44px] px-3 py-1.5 rounded-xl bg-[#E6EDFF] hover:bg-[#D8E5FF] text-[#1E44B8] font-bold text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Users className="w-3.5 h-3.5" aria-hidden="true" />
                  Bagi rata semua
                </button>
              )}
            </div>
          </div>

          {/* Daftar Kartu Item ("Struk yang Sudah Diberi Pemilik") */}
          <div className="space-y-2.5">
            {filteredItems.length === 0 ? (
              <div className="bg-[#F4F7FC] border border-dashed border-[#D8E2F2] rounded-2xl p-6 text-center space-y-1.5">
                <CheckCircle2
                  className="w-7 h-7 text-[#146346] mx-auto"
                  aria-hidden="true"
                />
                <p className="text-sm font-bold text-[#146346]">
                  Semua pesanan sudah dibagi.
                </p>
                <p className="text-xs text-[#4A5B7C]">
                  Lanjutkan ke halaman hasil untuk menyalin pesan atau membuat
                  link.
                </p>
              </div>
            ) : (
              filteredItems.map((item) => {
                const alloc = allocationByItemId.get(item.id);
                const isComplete = isItemFullyAllocated(
                  item,
                  alloc,
                  validParticipantIds,
                );

                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={isLockedFinal}
                    aria-label={`Bagi pesanan ${item.name}`}
                    onClick={() => {
                      if (!isLockedFinal) {
                        setActiveSheetItemId(item.id);
                      }
                    }}
                    className={`w-full text-left rounded-2xl p-3.5 sm:p-4 border transition-colors cursor-pointer space-y-3 ${
                      isComplete
                        ? "bg-[#F4F7FC] border-[#D8E2F2] hover:border-[#2855D9]"
                        : "border-2 border-[#F5CA86] bg-[#FFF3E6]/40 hover:border-[#9A4A12]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-lg bg-white border border-[#D8E2F2] text-[#17233B] text-xs font-extrabold tabular-money">
                            {item.quantity}x
                          </span>
                          <h3 className="text-sm font-extrabold text-[#17233B] truncate">
                            {item.name}
                          </h3>
                        </div>
                        {item.includedModifiers?.length ? <p className="mt-1 text-xs text-[#4A5B7C]">Termasuk {item.includedModifiers.join(", ")}</p> : null}
                        <p className="text-[11px] text-[#4A5B7C] mt-1">
                          {alloc?.mode === "shared"
                            ? `Dibagi bersama (${
                                alloc.participantIds?.length ?? 0
                              } orang)`
                            : `Dibagi sesuai jumlah`}
                        </p>
                      </div>

                      <div className="text-right shrink-0 space-y-1">
                        <span className="text-sm font-extrabold text-[#17233B] tabular-money block">
                          {formatRupiah(item.lineAmount)}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold ${
                            isComplete
                              ? "bg-white border border-[#D8E2F2] text-[#2855D9]"
                              : "bg-[#9A4A12] text-white"
                          }`}
                        >
                          {isComplete ? "Ubah" : "Pilih orang"}
                          <ChevronRight
                            className="w-3 h-3"
                            aria-hidden="true"
                          />
                        </span>
                      </div>
                    </div>

                    {/* Chip Pemilik Item */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-[#D8E2F2]/70">
                      {alloc?.mode === "units" &&
                        Object.entries(alloc.unitCounts ?? {})
                          .filter(([, count]) => count > 0)
                          .map(([pid, count]) => {
                            const identity = visualMap[pid];
                            if (!identity) return null;
                            const shareRp =
                              calc.itemGrossAllocations[item.id]?.[pid] ?? 0;
                            return (
                              <ParticipantChip
                                key={pid}
                                identity={identity}
                                size="sm"
                                suffix={`${count}x · ${formatRupiah(shareRp)}`}
                              />
                            );
                          })}

                      {alloc?.mode === "shared" &&
                        (alloc.participantIds ?? []).map((pid) => {
                          const identity = visualMap[pid];
                          if (!identity) return null;
                          const shareRp =
                            calc.itemGrossAllocations[item.id]?.[pid] ?? 0;
                          return (
                            <ParticipantChip
                              key={pid}
                              identity={identity}
                              size="sm"
                              suffix={formatRupiah(shareRp)}
                            />
                          );
                        })}

                      {!isComplete && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-[#FFF3E6] text-[#9A4A12]">
                          <HandPlatter
                            className="w-3.5 h-3.5 shrink-0"
                            aria-hidden="true"
                          />
                          Pilih siapa yang pesan
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>
        </fieldset>
      </main>

      {/* Bottom Sheet Alokasi Item */}
      {activeSheetItem && activeSheetAlloc && (
        <div
          className={`${ui.sheetBackdrop} fixed inset-0 z-50 bg-[#17233B]/50 backdrop-blur-xs flex items-end justify-center`}
          onClick={() => setActiveSheetItemId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="sheet-item-title"
            onClick={(e) => e.stopPropagation()}
            className={`${ui.sheetPanel} w-full max-w-xl bg-white rounded-t-3xl p-5 shadow-xl space-y-4 max-h-[85svh] overflow-y-auto overscroll-contain pb-[max(20px,env(safe-area-inset-bottom))]`}
          >
            {/* Mobile Drag Handle Indicator */}
            <div
              className="w-12 h-1.5 rounded-full bg-[#D8E2F2] mx-auto -mt-1"
              aria-hidden="true"
            />

            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-xs font-bold text-[#2855D9]">
                  Siapa yang pesan?
                </span>
                <h3
                  id="sheet-item-title"
                  className="text-base font-extrabold text-[#17233B] font-display"
                >
                  {activeSheetItem.quantity}x {activeSheetItem.name} ·{" "}
                  {formatRupiah(activeSheetItem.lineAmount)}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveSheetItemId(null)}
                className="w-10 h-10 rounded-full bg-[#F4F7FC] border border-[#D8E2F2] text-[#17233B] flex items-center justify-center cursor-pointer"
                aria-label="Tutup pembagian pesanan"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            {/* Pemilih Mode: Per Jumlah vs Dimakan Bersama */}
            <div className="grid grid-cols-2 gap-2 bg-[#F4F7FC] p-1.5 rounded-2xl border border-[#D8E2F2]">
              <button
                type="button"
                aria-pressed={activeSheetAlloc.mode === "units"}
                onClick={() => {
                  const defaultPid = bill.participants[0]?.id;
                  setItemAllocation(activeSheetItem.id, {
                    itemId: activeSheetItem.id,
                    mode: "units",
                    unitCounts:
                      activeSheetAlloc.mode === "units"
                        ? activeSheetAlloc.unitCounts
                        : defaultPid
                          ? { [defaultPid]: activeSheetItem.quantity }
                          : {},
                  });
                }}
                className={`min-h-[44px] rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  activeSheetAlloc.mode === "units"
                    ? "bg-[#2855D9] text-white shadow-xs"
                    : "text-[#4A5B7C]"
                }`}
              >
                Per porsi ({activeSheetItem.quantity} porsi)
              </button>
              <button
                type="button"
                aria-pressed={activeSheetAlloc.mode === "shared"}
                onClick={() => {
                  setItemAllocation(activeSheetItem.id, {
                    itemId: activeSheetItem.id,
                    mode: "shared",
                    participantIds:
                      activeSheetAlloc.mode === "shared" &&
                      (activeSheetAlloc.participantIds?.length ?? 0) > 0
                        ? activeSheetAlloc.participantIds
                        : bill.participants.map((p) => p.id),
                  });
                }}
                className={`min-h-[44px] rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  activeSheetAlloc.mode === "shared"
                    ? "bg-[#2855D9] text-white shadow-xs"
                    : "text-[#4A5B7C]"
                }`}
              >
                Dimakan bareng
              </button>
            </div>

            {/* Isi Mode Per Jumlah */}
            {activeSheetAlloc.mode === "units" ? (
              <div className="space-y-3">
                {(() => {
                  const counts = activeSheetAlloc.unitCounts ?? {};
                  const allocatedSum = Object.values(counts).reduce(
                    (a, b) => a + b,
                    0,
                  );
                  const remaining = activeSheetItem.quantity - allocatedSum;

                  return (
                    <div
                      role="status"
                      className={`p-3 rounded-xl text-xs font-bold flex items-center justify-between ${
                        remaining === 0
                          ? "bg-[#E6F5EF] text-[#146346]"
                          : "bg-[#FFF3E6] text-[#9A4A12]"
                      }`}
                    >
                      <span>
                        {remaining === 0
                          ? `Semua ${activeSheetItem.quantity} porsi sudah terbagi.`
                          : remaining > 0
                            ? `Sisa ${remaining} porsi belum dibagi.`
                            : `Kelebihan ${Math.abs(
                                remaining,
                              )} porsi dari jumlah di struk (${
                                activeSheetItem.quantity
                              }).`}
                      </span>
                      <span className="tabular-money">
                        {allocatedSum}/{activeSheetItem.quantity} porsi
                      </span>
                    </div>
                  );
                })()}

                <div className="space-y-2">
                  {bill.participants.map((p) => {
                    const identity = visualMap[p.id];
                    if (!identity) return null;
                    const currentUnits =
                      activeSheetAlloc.unitCounts?.[p.id] ?? 0;

                    return (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-[#F4F7FC] border border-[#D8E2F2]"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <ParticipantAvatar identity={identity} />
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-[#17233B] truncate">
                              {identity.displayLabel}
                            </p>
                            {currentUnits > 0 && (
                              <p className="text-xs font-semibold text-[#2855D9] tabular-money">
                                {formatRupiah(
                                  calc.itemGrossAllocations[
                                    activeSheetItem.id
                                  ]?.[p.id] ?? 0,
                                )}
                              </p>
                            )}
                          </div>
                        </div>

                        {activeSheetItem.quantity === 1 ? (
                          <button
                            type="button"
                            aria-label={`Pilih ${p.name} untuk pesanan ini`}
                            onClick={() => {
                              setItemAllocation(activeSheetItem.id, {
                                itemId: activeSheetItem.id,
                                mode: "units",
                                unitCounts: { [p.id]: 1 },
                              });
                              setActiveSheetItemId(null);
                            }}
                            className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold cursor-pointer ${
                              currentUnits === 1
                                ? "bg-[#2855D9] text-white"
                                : "bg-white border border-[#D8E2F2] text-[#17233B]"
                            }`}
                          >
                            {currentUnits === 1 ? (
                              <span className="inline-flex items-center gap-1">
                                <Check
                                  className="w-3.5 h-3.5"
                                  aria-hidden="true"
                                />
                                Dipilih
                              </span>
                            ) : (
                              "Pilih"
                            )}
                          </button>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={currentUnits === 0}
                              onClick={() => {
                                const nextCount = Math.max(0, currentUnits - 1);
                                const nextMap = {
                                  ...(activeSheetAlloc.unitCounts ?? {}),
                                  [p.id]: nextCount,
                                };
                                if (nextCount === 0) delete nextMap[p.id];
                                setItemAllocation(activeSheetItem.id, {
                                  itemId: activeSheetItem.id,
                                  mode: "units",
                                  unitCounts: nextMap,
                                });
                              }}
                              className="w-11 h-11 rounded-xl bg-white border border-[#D8E2F2] flex items-center justify-center text-[#17233B] cursor-pointer disabled:opacity-40"
                              aria-label={`Kurangi porsi ${p.name}`}
                            >
                              <Minus className="w-4 h-4" aria-hidden="true" />
                            </button>
                            <span className="w-8 text-center text-sm font-extrabold text-[#17233B] tabular-money">
                              {currentUnits}
                            </span>
                            <button
                              type="button"
                              disabled={
                                Object.values(
                                  activeSheetAlloc.unitCounts ?? {},
                                ).reduce((sum, count) => sum + count, 0) >=
                                activeSheetItem.quantity
                              }
                              onClick={() => {
                                const nextCount = currentUnits + 1;
                                setItemAllocation(activeSheetItem.id, {
                                  itemId: activeSheetItem.id,
                                  mode: "units",
                                  unitCounts: {
                                    ...(activeSheetAlloc.unitCounts ?? {}),
                                    [p.id]: nextCount,
                                  },
                                });
                              }}
                              className="w-11 h-11 rounded-xl bg-[#2855D9] text-white flex items-center justify-center cursor-pointer disabled:opacity-40"
                              aria-label={`Tambah porsi ${p.name}`}
                            >
                              <Plus className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* Isi Mode Dimakan Bersama */
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 bg-[#EAF0FA] p-3 rounded-xl text-xs">
                  <span className="font-bold text-[#17233B] inline-flex items-center gap-1.5">
                    <Users
                      className="w-4 h-4 text-[#2855D9]"
                      aria-hidden="true"
                    />
                    Dibagi rata ke{" "}
                    {activeSheetAlloc.participantIds?.length ?? 0} orang
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setItemAllocation(activeSheetItem.id, {
                        itemId: activeSheetItem.id,
                        mode: "shared",
                        participantIds: bill.participants.map((p) => p.id),
                      })
                    }
                    className="font-bold text-[#2855D9] hover:underline cursor-pointer"
                  >
                    Pilih semua teman
                  </button>
                </div>

                <div className="space-y-2">
                  {bill.participants.map((p) => {
                    const identity = visualMap[p.id];
                    if (!identity) return null;
                    const isSelected = (
                      activeSheetAlloc.participantIds ?? []
                    ).includes(p.id);
                    const shareRp =
                      calc.itemGrossAllocations[activeSheetItem.id]?.[p.id] ??
                      0;

                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => {
                          const currentIds =
                            activeSheetAlloc.participantIds ?? [];
                          const nextIds = isSelected
                            ? currentIds.filter((id) => id !== p.id)
                            : [...currentIds, p.id];
                          setItemAllocation(activeSheetItem.id, {
                            itemId: activeSheetItem.id,
                            mode: "shared",
                            participantIds: nextIds,
                          });
                        }}
                        className={`w-full flex items-center justify-between gap-3 p-3 rounded-2xl border text-left transition-colors cursor-pointer ${
                          isSelected
                            ? "bg-[#E6EDFF] border-[#2855D9]"
                            : "bg-[#F4F7FC] border-[#D8E2F2]"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <ParticipantAvatar identity={identity} />
                          <div>
                            <p className="text-sm font-bold text-[#17233B]">
                              {identity.displayLabel}
                            </p>
                            {isSelected && (
                              <p className="text-xs font-semibold text-[#2855D9] tabular-money">
                                Bagian: {formatRupiah(shareRp)}
                              </p>
                            )}
                          </div>
                        </div>

                        <span
                          className={`w-6 h-6 rounded-full flex items-center justify-center ${
                            isSelected
                              ? "bg-[#2855D9] text-white"
                              : "bg-white border border-[#D8E2F2]"
                          }`}
                        >
                          {isSelected && (
                            <Check className="w-3.5 h-3.5" aria-hidden="true" />
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={
                !isItemFullyAllocated(
                  activeSheetItem,
                  activeSheetAlloc,
                  validParticipantIds,
                )
              }
              onClick={() => setActiveSheetItemId(null)}
              className="w-full min-h-[48px] rounded-xl bg-[#2855D9] hover:bg-[#1E44B8] text-white font-bold text-sm cursor-pointer disabled:opacity-50"
            >
              Selesai membagi
            </button>
          </div>
        </div>
      )}

      <ActionBar
        title={
          unallocatedItems.length === 0
            ? "Semua pesanan sudah dibagi"
            : unallocatedItems.length + " pesanan belum dibagi"
        }
        detail={formatRupiah(receiptTotal)}
        label="Lihat hasil"
        onClick={handleProceedToResult}
        pending={proceedPending}
        disabled={unallocatedItems.length > 0}
      />
    </div>
  );
}
