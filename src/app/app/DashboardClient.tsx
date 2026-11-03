"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Clock, Trash2 } from "lucide-react";
import { deleteBillAction } from "@/app/actions/bills";
import { NewBillClient } from "@/app/bills/new/NewBillClient";
import { formatRupiah } from "@/domain/billing/money";
import type { BillDocument } from "@/domain/billing/types";
import { AppHeader } from "@/components/product/AppHeader";
import ui from "@/components/product/product.module.css";

interface DashboardClientProps {
  host: {
    uid: string;
    email: string;
    displayName: string;
    isDevSandboxUser?: boolean;
    isAdmin?: boolean;
  };
  initialBills: BillDocument[];
  hasMoreBills: boolean;
  latestDraft: BillDocument | null;
  quotaStatus: import("@/app/bills/new/NewBillClient").ScanQuotaStatus;
}

function billHref(bill: BillDocument) {
  return `/bills/${bill.id}/${bill.status === "finalized" ? "result" : bill.confirmedInputHash ? "split" : "review"}`;
}

export function DashboardClient({
  host,
  initialBills,
  hasMoreBills,
  latestDraft: initialLatestDraft,
  quotaStatus,
}: DashboardClientProps) {
  const router = useRouter();
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const bills = initialBills.filter((bill) => !deletedIds.includes(bill.id));
  const latestDraft =
    initialLatestDraft && !deletedIds.includes(initialLatestDraft.id)
      ? initialLatestDraft
      : null;

  function handleDeleteBill(bill: BillDocument) {
    if (
      !window.confirm(
        `Hapus tagihan “${bill.title}”? Tagihan tidak bisa dikembalikan dan link yang sudah dibagikan akan nonaktif.`,
      )
    )
      return;
    setErrorBanner(null);
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
        onLogout={handleLogout}
        pending={isPending}
      />
      <main className={ui.main}>
        {errorBanner && (
          <p role="alert" className={ui.error}>
            {errorBanner}
          </p>
        )}
        <NewBillClient embedded quotaStatus={quotaStatus} />
        {latestDraft && (
          <section className={ui.resume} aria-labelledby="resume-heading">
            <div>
              <span className={ui.resumeLabel}>
                <Clock size={15} aria-hidden="true" />
                Lanjutkan tagihanmu
              </span>
              <h2 id="resume-heading">{latestDraft.title}</h2>
              <p>
                {latestDraft.items.length} pesanan ·{" "}
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
              <h3>Belum ada tagihan.</h3>
              <p>
                Tagihan yang kamu buat akan muncul di sini. Mulai dari foto
                struk atau isi manual.
              </p>
            </div>
          ) : (
            <div className={ui.billList}>
              {bills.map((bill) => (
                <div key={bill.id} className={ui.billRow}>
                  <Link href={billHref(bill)} className={ui.billLink}>
                    <div className={ui.billRowTop}>
                      <span className={ui.billTitle}>{bill.title}</span>
                      <span className={`${ui.billAmount} tabular-money`}>
                        {bill.confirmedGrandTotal === null
                          ? "Total belum diisi"
                          : formatRupiah(bill.confirmedGrandTotal)}
                      </span>
                    </div>
                    <div className={ui.billMetadata}>
                      <span
                        className={`${ui.badge} ${bill.status === "finalized" ? ui.badgeReady : ""}`}
                      >
                        {bill.status === "finalized"
                          ? "Siap dibagikan"
                          : "Belum selesai"}
                      </span>
                      <span>
                        {bill.items.length} pesanan · {bill.participants.length}{" "}
                        orang
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
                    <Trash2 size={17} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
