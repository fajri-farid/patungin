import { billTrackingView, trackingLabel } from "@/domain/billing/tracking";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  ReceiptText,
} from "lucide-react";
import { formatRupiah } from "@/domain/billing/money";
import { getAuthenticatedHost } from "@/server/auth/session";
import { listBillsByOwner } from "@/server/store/repository";
import { decodeBillCursor } from "@/server/store/bill-pagination";
import { AppHeader } from "@/components/product/AppHeader";
import ui from "@/components/product/product.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Riwayat tagihan" };

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    after?: string | string[];
    before?: string | string[];
  }>;
}) {
  let host = null;
  try {
    host = await getAuthenticatedHost();
  } catch {
    redirect("/login");
  }
  if (!host) redirect("/login");
  const params = await searchParams;
  if (
    (params.after !== undefined &&
      (typeof params.after !== "string" || !decodeBillCursor(params.after))) ||
    (params.before !== undefined &&
      (typeof params.before !== "string" ||
        !decodeBillCursor(params.before))) ||
    (params.after !== undefined && params.before !== undefined)
  )
    redirect("/history");
  const { bills, previousCursor, nextCursor } = await listBillsByOwner(
    host.uid,
    {
      pageSize: 10,
      after: typeof params.after === "string" ? params.after : undefined,
      before: typeof params.before === "string" ? params.before : undefined,
    },
  );

  return (
    <div className={ui.page}>
      <AppHeader
        email={host.email}
        admin={host.isAdmin}
        history
        activePage="history"
      />
      <main className={ui.main}>
        <div className={ui.intro}>
          <h1>Riwayat tagihan.</h1>
          <p>
            Lanjutkan yang belum selesai atau buka rincian yang sudah dibagikan.
          </p>
        </div>
        <section className={ui.panel} aria-label="Daftar tagihan tersimpan">
          {bills.length === 0 && (params.after || params.before) ? (
            <div className={ui.empty}>
              <div className={ui.emptyIconWrap} aria-hidden="true">
                <ReceiptText size={24} />
              </div>
              <h2>Halaman ini sudah kosong.</h2>
              <p>Daftar tagihan mungkin sudah berubah.</p>
              <Link href="/history" className={ui.secondary}>
                Lihat tagihan terbaru
              </Link>
            </div>
          ) : bills.length === 0 ? (
            <div className={ui.empty}>
              <div className={ui.emptyIconWrap} aria-hidden="true">
                <ReceiptText size={24} />
              </div>
              <h2>Belum ada tagihan.</h2>
              <p>
                Mulai patungan pertamamu. Hasilnya bisa kamu buka lagi di sini.
              </p>
              <Link href="/app" className={ui.primary}>
                Buat tagihan <ArrowRight size={17} aria-hidden="true" />
              </Link>
            </div>
          ) : (
            <div className={ui.billList}>
              {bills.map((bill) => {
                const isFinalized = bill.status === "finalized";
                return (
                  <div className={ui.billRow} key={bill.id}>
                    <Link
                      href={`/bills/${bill.id}/${isFinalized ? "result" : bill.confirmedInputHash ? "split" : "review"}`}
                      className={ui.billLink}
                    >
                      <div className={ui.billRowTop}>
                        <span className={ui.billTitle}>{bill.title}</span>
                        <span className={`${ui.billAmount} tabular-money`}>
                          {bill.confirmedGrandTotal === null
                            ? "Total belum diisi"
                            : formatRupiah(bill.confirmedGrandTotal)}
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-[#4A5B7C]">{trackingLabel(billTrackingView(bill))}</p>
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
                              {bill.confirmedInputHash
                                ? "Bagi pesanan"
                                : "Cek struk"}
                            </>
                          )}
                        </span>
                        <span>
                          {bill.merchant || "Tempat belum diisi"} ·{" "}
                          {bill.items.length} pesanan ·{" "}
                          {bill.participants.length} orang
                        </span>
                      </div>
                    </Link>
                    <ArrowRight
                      size={17}
                      className="shrink-0 text-[#7687A6]"
                      aria-hidden="true"
                    />
                  </div>
                );
              })}
            </div>
          )}
          {(previousCursor || nextCursor) && (
            <nav
              className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#D8E2F2] pt-4"
              aria-label="Halaman riwayat tagihan"
            >
              {previousCursor ? (
                <Link
                  href={`/history?before=${previousCursor}`}
                  className={ui.secondary}
                  prefetch={false}
                >
                  <ArrowLeft size={16} aria-hidden="true" />
                  Sebelumnya
                </Link>
              ) : (
                <span />
              )}
              {nextCursor && (
                <Link
                  href={`/history?after=${nextCursor}`}
                  className={ui.secondary}
                  prefetch={false}
                >
                  Selanjutnya <ArrowRight size={16} aria-hidden="true" />
                </Link>
              )}
            </nav>
          )}
        </section>
      </main>
    </div>
  );
}
