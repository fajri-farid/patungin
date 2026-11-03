import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ReceiptText } from "lucide-react";
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
      <AppHeader history />
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
              <h2>Halaman ini sudah kosong.</h2>
              <p>Daftar tagihan mungkin sudah berubah.</p>
              <Link href="/history" className={ui.secondary}>
                Lihat tagihan terbaru
              </Link>
            </div>
          ) : bills.length === 0 ? (
            <div className={ui.empty}>
              <ReceiptText size={34} aria-hidden="true" />
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
              {bills.map((bill) => (
                <div className={ui.billRow} key={bill.id}>
                  <Link
                    href={`/bills/${bill.id}/${bill.status === "finalized" ? "result" : bill.confirmedInputHash ? "split" : "review"}`}
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
                    <div className={ui.billMetadata}>
                      <span
                        className={`${ui.badge} ${bill.status === "finalized" ? ui.badgeReady : ""}`}
                      >
                        {bill.status === "finalized"
                          ? "Siap dibagikan"
                          : "Belum selesai"}
                      </span>
                      <span>
                        {bill.merchant || "Tempat belum diisi"} ·{" "}
                        {bill.items.length} pesanan · {bill.participants.length}{" "}
                        orang
                      </span>
                    </div>
                  </Link>
                  <ArrowRight
                    size={17}
                    className="text-[#4A5B7C]"
                    aria-hidden="true"
                  />
                </div>
              ))}
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
