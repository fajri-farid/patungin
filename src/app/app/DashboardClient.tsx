"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  ReceiptText,
  Trash2,
} from "lucide-react";
import { deleteBillAction } from "@/app/actions/bills";
import { NewBillClient } from "@/app/bills/new/NewBillClient";
import { formatRupiah } from "@/domain/billing/money";
import type { BillSummary } from "@/domain/billing/summary";
import { AppHeader } from "@/components/product/AppHeader";
import ui from "@/components/product/product.module.css";

interface DashboardClientProps {
  receiptsEnabled: boolean;
  host: {
    uid: string;
    email: string;
    displayName: string;
    isDevSandboxUser?: boolean;
    isAdmin?: boolean;
  };
  initialBills: BillSummary[];
  hasMoreBills: boolean;
  latestDraft: BillSummary | null;
  quotaStatus: import("@/app/bills/new/NewBillClient").ScanQuotaStatus;
}

function billHref(bill: BillSummary) {
  return `/bills/${bill.id}/${bill.status === "finalized" ? "result" : bill.confirmedInputHash ? "split" : "review"}`;
}

function draftStepLabel(bill: BillSummary) {
  return bill.confirmedInputHash ? "Bagi pesanan" : "Cek struk";
}

export function DashboardClient({
  host,
  initialBills,
  hasMoreBills,
  latestDraft: initialLatestDraft,
  quotaStatus,
  receiptsEnabled,
}: DashboardClientProps) {
  const router = useRouter();
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const bills = initialBills.filter((bill) => !deletedIds.includes(bill.id));
  const latestDraft =
    initialLatestDraft && !deletedIds.includes(initialLatestDraft.id)
      ? initialLatestDraft
      : null;

  function handleDeleteBill(bill: BillSummary) {
    if (
      !window.confirm(
        `Hapus tagihan “${bill.title}”? Tagihan dan catatan pembayarannya tidak bisa dikembalikan. Link yang sudah dibagikan juga tidak bisa dibuka lagi.`,
      )
    )
      return;
    setErrorBanner(null);
    setDeletingId(bill.id);
    startTransition(async () => {
      try {
        const response = await deleteBillAction({ billId: bill.id });
        if (!response.ok) {
          setErrorBanner(
            response.error ?? "Tagihan belum terhapus. Coba lagi.",
          );
          return;
        }
        setDeletedIds((current) => [...current, bill.id]);
        router.refresh();
      } catch {
        setErrorBanner(
          "Tagihan belum terhapus. Periksa koneksi lalu coba lagi.",
        );
      } finally {
        setDeletingId(null);
      }
    });
  }

  function handleLogout() {
    startTransition(async () => {
      try {
        const response = await fetch("/api/auth/logout", { method: "POST" });
        if (!response.ok) throw new Error();
        router.replace("/login");
        router.refresh();
      } catch {
        setErrorBanner("Belum bisa keluar. Periksa koneksi lalu coba lagi.");
      }
    });
  }

  return (
    <div className={ui.page}>
      <AppHeader
        email={host.email}
        admin={host.isAdmin}
        activePage="app"
        onLogout={handleLogout}
        pending={isPending}
      />
      <main className={ui.main}>
        {errorBanner && (
          <div role="alert" className={`${ui.error} flex items-start gap-2.5`}>
            <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{errorBanner}</span>
          </div>
        )}

        {latestDraft && (
          <section className={ui.resume} aria-labelledby="resume-heading">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={ui.resumeLabel}>
                  <Clock size={14} aria-hidden="true" />
                  Lanjutkan · {draftStepLabel(latestDraft)}
                </span>
                {latestDraft.confirmedGrandTotal !== null && (
                  <span className="text-sm font-extrabold text-[#17233B] tabular-money">
                    {formatRupiah(latestDraft.confirmedGrandTotal)}
                  </span>
                )}
              </div>
              <h2 id="resume-heading">{latestDraft.title}</h2>
              <p>
                {latestDraft.merchant ? `${latestDraft.merchant} · ` : ""}
                {latestDraft.itemCount} pesanan ·{" "}
                {latestDraft.confirmedInputHash
                  ? "Lanjut pilih siapa pesan apa"
                  : "Lanjut cek pesanan dan harga"}
              </p>
            </div>
            <Link href={billHref(latestDraft)} className={ui.primary}>
              Lanjutkan tagihan <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </section>
        )}

        <NewBillClient
          embedded
          quotaStatus={quotaStatus}
          receiptsEnabled={receiptsEnabled}
        />

        <section className={ui.panel} aria-labelledby="saved-heading">
          <div className={ui.listHeading}>
            <h2 id="saved-heading" className={ui.sectionTitle}>
              Tagihan tersimpan
            </h2>
            {hasMoreBills && (
              <Link href="/history">
                Lihat semua <ArrowRight size={15} aria-hidden="true" />
              </Link>
            )}
          </div>
          {bills.length === 0 ? (
            <div className={ui.empty}>
              <div className={ui.emptyIconWrap} aria-hidden="true">
                <ReceiptText size={24} />
              </div>
              <h3>Belum ada tagihan.</h3>
              <p>
                Tagihan yang kamu buat akan muncul di sini. Mulai dari foto
                struk atau isi manual di atas.
              </p>
            </div>
          ) : (
            <div className={ui.billList}>
              {bills.map((bill) => {
                const isDeletingThis = deletingId === bill.id;
                const isFinalized = bill.status === "finalized";
                return (
                  <div
                    key={bill.id}
                    className={`${ui.billRow} ${
                      isDeletingThis ? ui.billRowDeleting : ""
                    }`}
                  >
                    <Link href={billHref(bill)} className={ui.billLink}>
                      <div className={ui.billRowTop}>
                        <span className={ui.billTitle}>{bill.title}</span>
                        <span className={`${ui.billAmount} tabular-money`}>
                          {bill.confirmedGrandTotal === null
                            ? "Total belum diisi"
                            : formatRupiah(bill.confirmedGrandTotal)}
                        </span>
                      </div>
                      {bill.paymentTrackingLabel && <p className="text-xs font-semibold text-[#4A5B7C]">{bill.paymentTrackingLabel}</p>}
                      <div className={ui.billMetadata}>
                        <span
                          className={`${ui.badge} ${
                            isFinalized ? ui.badgeReady : ""
                          }`}
                        >
                          {isFinalized ? (
                            <>
                              <CheckCircle2 size={12} aria-hidden="true" />
                              Siap dibagikan
                            </>
                          ) : (
                            <>
                              <Clock size={12} aria-hidden="true" />
                              {draftStepLabel(bill)}
                            </>
                          )}
                        </span>
                        <span>
                          {bill.merchant ? `${bill.merchant} · ` : ""}
                          {bill.itemCount} pesanan ·{" "}
                          {bill.participantCount} orang
                        </span>
                      </div>
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDeleteBill(bill)}
                      disabled={isPending}
                      className={ui.iconButton}
                      aria-label={`Hapus tagihan ${bill.title}`}
                    >
                      {isDeletingThis ? (
                        <Loader2
                          size={17}
                          className={ui.spinner}
                          aria-hidden="true"
                        />
                      ) : (
                        <Trash2 size={17} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
