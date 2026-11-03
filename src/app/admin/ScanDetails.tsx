import type { AdminScanActivity } from "@/server/admin/monitoring";
import { dateLabel, durationLabel, scanState } from "./admin-utils";
import { ScanExplanation } from "./ScanExplanation";
import { StatusBadge } from "./UserManagement";
import styles from "./admin.module.css";

const APPLICATION_LABELS = {
  applied: "Diterapkan ke draft",
  draft_changed: "Tidak diterapkan: draft berubah",
  access_inactive: "Tidak diterapkan: akses pemilik tidak aktif",
  bill_finalized: "Tidak diterapkan: tagihan sudah bukan draft",
  bill_deleted: "Tidak diterapkan: tagihan dihapus",
  not_requested: "Penerapan hasil tidak diminta",
};

/** Identical, fully expanded details in monitoring and operational logs. */
export function ScanDetails({
  scan,
  now,
}: {
  scan: AdminScanActivity;
  now: number;
}) {
  const state = scanState(scan, now);
  return (
    <>
      <StatusBadge state={state} />
      <ScanExplanation scan={scan} now={now} />
      <section
        className={styles.detailSection}
        aria-label="Rincian scan lengkap"
      >
        <h3>Rincian scan</h3>
        <dl className={styles.detailList}>
          <div>
            <dt>Status scan</dt>
            <dd>{state.label}</dd>
          </div>
          <div>
            <dt>Nama pengguna</dt>
            <dd>{scan.displayName}</dd>
          </div>
          <div>
            <dt>Email pengguna</dt>
            <dd>{scan.email || "Data akun tidak tersedia"}</dd>
          </div>
          <div>
            <dt>ID akun</dt>
            <dd>
              <code>{scan.ownerUid}</code>
            </dd>
          </div>
          <div>
            <dt>ID aktivitas scan</dt>
            <dd>
              <code>{scan.id}</code>
            </dd>
          </div>
          <div>
            <dt>ID tagihan</dt>
            <dd>
              <code>{scan.billId}</code>
            </dd>
          </div>
          <div>
            <dt>Model pembacaan</dt>
            <dd>{scan.model}</dd>
          </div>
          <div>
            <dt>Waktu mulai</dt>
            <dd>{dateLabel(scan.reservedAt)}</dd>
          </div>
          <div>
            <dt>Dikirim ke pembaca</dt>
            <dd>{dateLabel(scan.dispatchedAt, "Belum tercatat")}</dd>
          </div>
          <div>
            <dt>Waktu selesai</dt>
            <dd>{dateLabel(scan.completedAt, "Belum tercatat")}</dd>
          </div>
          <div>
            <dt>Durasi pemrosesan</dt>
            <dd>{durationLabel(scan)}</dd>
          </div>
          <div>
            <dt>Penerapan hasil</dt>
            <dd>
              {scan.applicationOutcome
                ? APPLICATION_LABELS[scan.applicationOutcome]
                : scan.state === "succeeded"
                  ? "Informasi penerapan belum tercatat"
                  : "Belum ada hasil berhasil yang diterapkan"}
            </dd>
          </div>
          <div>
            <dt>Kode hasil</dt>
            <dd>
              <code>{scan.errorCode || "Tidak ada"}</code>
            </dd>
          </div>
          <div>
            <dt>ID referensi permintaan</dt>
            <dd>
              <code>{scan.requestId || "Belum tercatat"}</code>
            </dd>
          </div>
        </dl>
      </section>
    </>
  );
}
