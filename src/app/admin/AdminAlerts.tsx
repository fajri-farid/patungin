"use client";

import { Bell, ChevronRight } from "lucide-react";
import type { loadAdminAlertCounts } from "@/app/actions/admin";
import type { AlertKind, AlertsPage } from "@/server/admin/data";
import { AdminPreparation } from "./AdminPreparation";
import { dateLabel, monthLabel } from "./admin-utils";
import styles from "./admin.module.css";

const LABELS = {
  low: "Kuota menipis",
  expiry: "Akses segera berakhir",
  failures: "Kegagalan tinggi",
};
export function AdminAlerts({
  data,
  counts,
  kind,
  onFilter,
  onSelect,
  onPrepared,
}: {
  data: AlertsPage;
  counts: Awaited<ReturnType<typeof loadAdminAlertCounts>> | null;
  kind: AlertKind;
  onFilter: (kind: AlertKind) => void;
  onSelect: (uid: string) => void;
  onPrepared: () => void;
}) {
  return (
    <section className={styles.panel} aria-labelledby="alerts-heading">
      <div className={styles.panelHeading}>
        <div>
          <h2 id="alerts-heading">Peringatan operasional</h2>
          <p>
            Akun aktif yang perlu ditinjau. Admin deployment tidak disertakan.
          </p>
        </div>
        <Bell size={22} aria-hidden="true" />
      </div>
      <div
        className={styles.segmented}
        role="group"
        aria-label="Jenis peringatan"
      >
        {(Object.keys(LABELS) as AlertKind[]).map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={kind === value}
            onClick={() => onFilter(value)}
          >
            {LABELS[value]}
            {counts?.[value]?.ok && counts[value].data.count > 0 && (
              <span className={styles.alertPill} aria-label={`${counts[value].data.more ? "Setidaknya " : ""}${counts[value].data.count} peringatan`}>
                {counts[value].data.count}{counts[value].data.more ? "+" : ""}
              </span>
            )}
          </button>
        ))}
      </div>
      <p className={styles.scopeNote}>
        Angka menunjukkan akun pada halaman pertama tiap jenis. Tanda + berarti masih ada halaman berikutnya; tanpa angka belum tentu kosong jika data belum berhasil dimuat.
        {counts && Object.values(counts).some((result) => !result.ok) && " Sebagian angka belum dapat dimuat; coba perbarui data."}
      </p>
      <p className={styles.scopeNote}>
        {kind === "low"
          ? `Sisa maksimal 5 scan untuk ${monthLabel(data.monthKey)}. Ringkasan diperbarui saat scan atau pengaturan akun berubah.`
          : kind === "expiry"
            ? "Akses berakhir dalam 7 hari ke depan, dihitung saat halaman pertama dimuat."
            : `Minimal 5 scan dengan hasil berhasil/gagal tercatat, dan minimal 50% gagal pada ${monthLabel(data.monthKey)}. Hasil sebelum pencatatan fitur ini tidak dihitung.`}
      </p>
      <div className={styles.alertList}>
        {data.items.map(
          ({ user, remaining, completed, failed, resultsSince }) => (
            <article className={styles.alertCard} key={user.uid}>
              <div className={styles.personCell}>
                <h3>{user.displayName}</h3>
                <span>{user.email}</span>
              </div>
              <div className={styles.alertValue}>
                <strong>
                  {kind === "low"
                    ? `${remaining} scan tersisa`
                    : kind === "expiry"
                      ? dateLabel(user.accessUntil)
                      : `${failed} dari ${completed} scan gagal`}
                </strong>
                {kind === "failures" && (
                  <small>Hasil dicatat sejak {dateLabel(resultsSince)}</small>
                )}
              </div>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => onSelect(user.uid)}
                aria-label={`Tinjau ${user.displayName}`}
              >
                Tinjau akun <ChevronRight size={16} aria-hidden="true" />
              </button>
            </article>
          ),
        )}
      </div>
      {!data.items.length && (
        <div className={styles.empty}>
          <Bell size={28} aria-hidden="true" />
          <h3>Tidak ada peringatan pada halaman ini</h3>
          <p>
            {data.next
              ? "Lanjutkan ke halaman berikutnya; akun yang nonaktif atau kedaluwarsa tidak ditampilkan."
              : "Daftar mengikuti data yang sudah dicatat. Gunakan persiapan akun lama jika fitur ini baru dipasang."}
          </p>
        </div>
      )}
      <p className={styles.scopeNote}>
        Daftar dicari di seluruh database dan dimuat bertahap. Tidak ada
        perubahan akun atau penambahan bonus otomatis.
      </p>
      <AdminPreparation onPrepared={onPrepared} />
    </section>
  );
}
