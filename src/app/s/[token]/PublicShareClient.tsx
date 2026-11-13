"use client";

import { PaymentTrackingPanel } from "@/components/PaymentTrackingPanel";
import { participantPaymentLabel } from "@/domain/billing/tracking";
import { refreshPublicShareAction } from "@/app/actions/bills";
import React, { useState, useTransition } from "react";
import { ReceiptPhoto } from "@/components/ReceiptPhoto";
import { CheckCircle2, ReceiptText, User, Users, Wallet } from "lucide-react";
import { formatRupiah } from "@/domain/billing/money";
import type { PublicShareProjection } from "@/domain/billing/types";
import { buildParticipantVisualMap } from "@/lib/palette";
import { normalizePaymentMethods } from "@/domain/billing/payment";
import { PaymentMethodsList } from "@/components/PaymentMethods";
import { ParticipantAvatar } from "@/components/ParticipantBadge";
import { ReceiptDetails } from "@/components/ReceiptDetails";
import ui from "@/components/product/product.module.css";
import { formatReceiptDate } from "@/components/product/billing-feedback";

interface PublicShareClientProps {
  shareToken: string;
  projection: PublicShareProjection;
}

export function PublicShareClient({ projection: initialProjection, shareToken }: PublicShareClientProps) {
  const [projection, setProjection] = useState(initialProjection);
  const [refreshing, startRefresh] = useTransition();
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<
    string | null | undefined
  >(
    projection.participants.length === 1
      ? projection.participants[0].id
      : undefined,
  );

  const visualMap = buildParticipantVisualMap(projection.participants);

  const payments = normalizePaymentMethods(
    projection.paymentMethods,
    projection.paymentNote,
  );

  const displayedParticipants =
    selectedPersonId === undefined
      ? []
      : selectedPersonId
        ? projection.participants.filter((p) => p.id === selectedPersonId)
        : projection.participants;

  if (unavailable) return <main className={ui.main}><h1 className={ui.sectionTitle}>Link sudah tidak tersedia.</h1><p>Minta link baru ke pembuat tagihan.</p></main>;

  return (
    <div className={ui.page}>
      <main className={ui.main}>
        {/* Header Rincian Publik */}
        <section className={`${ui.panel} space-y-4`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-[#2855D9] text-white flex items-center justify-center shrink-0 shadow-2xs">
                <ReceiptText className="w-6 h-6" aria-hidden="true" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#E6F5EF] text-[#146346]">
                    Rincian tagihan
                  </span>
                  <span className="text-xs font-semibold text-[#7687A6]">
                    Patungin
                  </span>
                </div>
                <h1 className="text-lg sm:text-xl font-extrabold text-[#17233B] font-display mt-1">
                  {projection.title}
                </h1>
                <p className="text-xs text-[#4A5B7C]">
                  {projection.merchant || "Makan bersama"}
                  {formatReceiptDate(projection.receiptDate)
                    ? ` · ${formatReceiptDate(projection.receiptDate)}`
                    : ""}
                </p>
              </div>
            </div>

            <div className="text-right shrink-0">
              <span className="text-[11px] font-semibold text-[#4A5B7C] block">
                Total tagihan
              </span>
              <span className="text-xl font-extrabold text-[#17233B] tabular-money">
                {formatRupiah(projection.grandTotal)}
              </span>
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-[#F4F7FC] border border-[#D8E2F2] flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-[#2855D9]" aria-hidden="true" />
              <span className="text-[#4A5B7C]">Ditalangi oleh:</span>
              <span className="font-extrabold text-[#17233B] text-sm">
                {projection.payerName}
              </span>
            </div>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#146346]">
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
              Total sesuai
            </span>
          </div>
        </section>

        {projection.paymentTracking && <PaymentTrackingPanel view={projection.paymentTracking} people={projection.participants} busy={refreshing} error={refreshError ? { message: refreshError } : null} onRefresh={() => {
          startRefresh(async () => {
            setRefreshError(null);
            try {
              const result = await refreshPublicShareAction(shareToken);
              if (result.ok && result.data) setProjection(result.data);
              else if (result.code === "LINK_UNAVAILABLE") setUnavailable(true);
              else setRefreshError(result.error ?? "Belum bisa memuat status terbaru. Coba lagi.");
            } catch { setRefreshError("Belum bisa memuat status terbaru. Periksa koneksi lalu coba lagi."); }
          });
        }} />}

        {/* Filter Cepat Teman & Daftar Bagian (Dibungkus dalam Wrapper Rapi) */}
        {projection.receiptPhoto && <section className={`${ui.panel} space-y-3`}>
          <h2 className={ui.sectionTitle}>Foto struk</h2>
          <ReceiptPhoto info={projection.receiptPhoto} src={`/api/s/${encodeURIComponent(shareToken)}/receipt-photo`} />
        </section>}
        <section
          aria-label="Rincian bagian per orang"
          className={`${ui.panel} space-y-4`}
        >
          {projection.participants.length > 1 ? (
            <div className="rounded-2xl bg-[#F4F7FC] border border-[#D8E2F2] p-3 space-y-2">
              <span className="text-xs font-bold text-[#17233B] flex items-center gap-1.5">
                <User
                  className="w-3.5 h-3.5 text-[#2855D9]"
                  aria-hidden="true"
                />
                Pilih namamu untuk cek bagian bayar.
              </span>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedPersonId(null)}
                  aria-pressed={selectedPersonId === null}
                  className={`min-h-[40px] px-3 py-1 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                    selectedPersonId === null
                      ? "bg-[#2855D9] text-white shadow-2xs"
                      : "bg-white border border-[#D8E2F2] text-[#4A5B7C] hover:text-[#17233B]"
                  }`}
                >
                  Semua ({projection.participants.length})
                </button>
                {projection.participants.map((person) => {
                  const isSelected = selectedPersonId === person.id;
                  return (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() =>
                        setSelectedPersonId(isSelected ? null : person.id)
                      }
                      aria-pressed={isSelected}
                      className={`min-h-[44px] min-w-0 max-w-full break-all px-3 py-1 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                        isSelected
                          ? "bg-[#2855D9] text-white shadow-2xs"
                          : "bg-white border border-[#D8E2F2] text-[#17233B] hover:border-[#2855D9]"
                      }`}
                    >
                      {person.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 pb-2 border-b border-[#D8E2F2]">
              <Users className="w-4 h-4 text-[#2855D9]" aria-hidden="true" />
              <span className="text-xs font-extrabold text-[#17233B]">
                Rincian bagian peserta
              </span>
            </div>
          )}

          {/* Kartu Bagian Tiap Orang */}
          <div className="space-y-3">
            {selectedPersonId === undefined && (
              <p className={ui.notice}>
                Pilih namamu di atas. Pesanan dan jumlah yang perlu kamu bayar
                akan muncul di sini.
              </p>
            )}
            {displayedParticipants.map((person) => {
              const identity = visualMap[person.id];

              return (
                <div
                  key={person.id}
                  className="bg-[#F4F7FC] border border-[#D8E2F2] rounded-2xl p-4 space-y-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {identity && <ParticipantAvatar identity={identity} />}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <h2 className="text-base font-extrabold text-[#17233B] truncate font-display">
                            {identity?.displayLabel ?? person.name}
                          </h2>
                          {person.isPayer && (
                            <span className="shrink-0 whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#17233B] text-white">
                              Pembayar
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#4A5B7C]">
                          {person.isPayer
                            ? "Sudah membayar tagihan lebih dulu"
                            : `Bayar ke ${projection.payerName}`}
                        </p>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span
                        className={`text-base font-extrabold tabular-money block ${
                          person.isPayer ? "text-[#4A5B7C]" : "text-[#2855D9]"
                        }`}
                      >
                        {person.isPayer
                          ? formatRupiah(person.consumptionTotal)
                          : formatRupiah(person.transferToPayerAmount)}
                      </span>
                      <span className="text-[10px] font-bold text-[#7687A6]">
                        {participantPaymentLabel(projection.paymentTracking, person, true)}
                      </span>
                    </div>
                  </div>

                  {/* Rincian Pesanan & Pajak */}
                  <div className="p-3 rounded-xl bg-white border border-[#D8E2F2] space-y-1.5 text-xs">
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
                        <span className="font-semibold tabular-money">
                          {adj.mode === "included"
                            ? formatRupiah(adj.absoluteAmount)
                            : `${
                                adj.signedAmount < 0 ? "-" : "+"
                              }${formatRupiah(adj.absoluteAmount)}`}
                        </span>
                      </div>
                    ))}

                    <div className="pt-2 border-t border-[#D8E2F2] flex items-center justify-between font-bold text-[#17233B]">
                      <span>Total bagian {person.name}</span>
                      <span className="tabular-money">
                        {formatRupiah(person.consumptionTotal)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className={`${ui.panel} space-y-4`}>
          <div className="flex items-center gap-2 pb-2 border-b border-[#D8E2F2]">
            <Wallet className="w-4 h-4 text-[#2855D9]" aria-hidden="true" />
            <h2 className="font-display text-base font-extrabold text-[#17233B]">
              Bayar ke {projection.payerName}
            </h2>
          </div>
          {payments.length > 0 ? (
            <PaymentMethodsList
              payments={payments}
              qrisShareToken={shareToken}
              payerName={projection.payerName}
            />
          ) : (
            <p className={ui.muted}>
              Minta nomor rekening atau QRIS ke {projection.payerName}.
            </p>
          )}
        </section>

        {projection.receiptDetails && (
          <ReceiptDetails
            details={projection.receiptDetails}
            grandTotal={projection.grandTotal}
          />
        )}

        <footer className="text-center text-[11px] text-[#7687A6] py-3">
          Dibagi dengan <strong>Patungin</strong>
        </footer>
      </main>
    </div>
  );
}
