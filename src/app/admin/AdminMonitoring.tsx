"use client";

import { useState } from "react";
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  ScanLine,
  Search,
  Users,
} from "lucide-react";
import type {
  AdminMonitoring as MonitoringData,
  AdminScanActivity,
} from "@/server/admin/monitoring";
import { AdminDialog } from "./AdminDialog";
import {
  dateLabel,
  durationLabel,
  monthLabel,
  numberLabel,
  scanState,
} from "./admin-utils";
import { StatusBadge } from "./UserManagement";
import type { MonitorPeriod } from "@/server/admin/pagination";
import styles from "./admin.module.css";
import { ScanExplanation } from "./ScanExplanation";
import { ScanDetails } from "./ScanDetails";

export function AdminMonitoring({
  data,
  onManageUsers,
  onPeriod,
  onSelectUser,
}: {
  data: MonitoringData;
  onManageUsers: () => void;
  onPeriod: (period: MonitorPeriod) => void;
  onSelectUser: (uid: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<AdminScanActivity | null>(null);
  const counts = { succeeded: 0, failed: 0, running: 0, unknown: 0 };
  data.activity.forEach((scan) => {
    counts[scanState(scan, data.evaluatedAt).key as keyof typeof counts]++;
  });
  const query = search.trim().toLowerCase();
  const filtered = data.activity.filter(
    (scan) =>
      (filter === "all" || scanState(scan, data.evaluatedAt).key === filter) &&
      `${scan.displayName} ${scan.email ?? ""} ${scan.id} ${scan.billId} ${scan.model} ${scan.errorCode ?? ""}`
        .toLowerCase()
        .includes(query),
  );
  const states = [
    { key: "succeeded", label: "Berhasil", tone: "green" },
    { key: "failed", label: "Gagal", tone: "red" },
    { key: "running", label: "Diproses", tone: "blue" },
    { key: "unknown", label: "Perlu dicek", tone: "amber" },
  ] as const;
  return (
    <>
      <div
        className={styles.metricGrid}
        aria-label={`Ringkasan pemakaian ${monthLabel(data.monthKey)}`}
      >
        <article className={styles.metric}>
          <div>
            <span>Pemakaian bulan ini</span>
            <ScanLine size={18} aria-hidden="true" />
          </div>
          <strong>
            {numberLabel(data.monthlyAttempts)}
            <small> scan</small>
          </strong>
          <p>Seluruh akun · {monthLabel(data.monthKey)}</p>
        </article>
        <article className={styles.metric}>
          <div>
            <span>Akun memakai scan</span>
            <Users size={18} aria-hidden="true" />
          </div>
          <strong>
            {numberLabel(data.accountsWithUsage)}
            <small> akun</small>
          </strong>
          <p>Memiliki pemakaian bulan ini</p>
        </article>
        <article className={styles.metric}>
          <div>
            <span>Scan berlangsung</span>
            <Activity size={18} aria-hidden="true" />
          </div>
          <strong>
            {data.activeScans}
            <small> proses</small>
          </strong>
          <p>Slot aktif saat data diperbarui</p>
        </article>
        <article
          className={styles.metric}
          data-attention={counts.failed + counts.unknown > 0}
        >
          <div>
            <span>Perlu perhatian</span>
            <Clock3 size={18} aria-hidden="true" />
          </div>
          <strong>
            {counts.failed + counts.unknown}
            <small> aktivitas</small>
          </strong>
          <p>
            Gagal / perlu dicek dari {data.activity.length} pada halaman ini
          </p>
        </article>
      </div>
      <div className={styles.overviewGrid}>
        <section
          className={styles.panel}
          aria-labelledby="activity-summary-heading"
        >
          <div className={styles.panelHeading}>
            <div>
              <h2 id="activity-summary-heading">Hasil aktivitas yang dimuat</h2>
              <p>
                Berdasarkan {data.activity.length} scan yang dimuat, bukan
                seluruh bulan.
              </p>
            </div>
          </div>
          <div
            className={styles.distribution}
            aria-label="Distribusi status scan"
          >
            {data.activity.length ? (
              states.map((state) =>
                counts[state.key] > 0 ? (
                  <span
                    key={state.key}
                    data-tone={state.tone}
                    style={{ flex: counts[state.key] }}
                    title={`${state.label}: ${counts[state.key]}`}
                  />
                ) : null,
              )
            ) : (
              <span data-tone="muted" />
            )}
          </div>
          <div className={styles.distributionLegend}>
            {states.map((state) => (
              <div key={state.key}>
                <span className={styles.legendDot} data-tone={state.tone} />
                <span>{state.label}</span>
                <strong>{counts[state.key]}</strong>
              </div>
            ))}
          </div>
        </section>
        <section
          className={`${styles.panel} ${styles.systemPanel}`}
          aria-labelledby="scan-service-heading"
        >
          <div className={styles.row}>
            <span className={styles.serviceIcon}>
              <ScanLine size={20} aria-hidden="true" />
            </span>
            <StatusBadge
              label={
                data.scanEnabled ? "Scan foto aktif" : "Scan foto nonaktif"
              }
              tone={data.scanEnabled ? "green" : "muted"}
            />
          </div>
          <h2 id="scan-service-heading">Pantau scan. Atur jatahnya.</h2>
          <p>
            Pemakaian mencatat percobaan scan yang diterima, termasuk yang
            gagal. Bonus menambah jatah tanpa menghapus pemakaian.
          </p>
          <button
            className={styles.textButton}
            type="button"
            onClick={onManageUsers}
          >
            Kelola kuota pengguna <ArrowUpRight size={16} aria-hidden="true" />
          </button>
        </section>
      </div>
      <section className={styles.panel} aria-labelledby="scan-activity-heading">
        <div className={styles.panelHeading}>
          <div>
            <h2 id="scan-activity-heading">Aktivitas scan</h2>
            <p>Waktu, hasil, dan model pembacaan untuk setiap percobaan.</p>
          </div>
          <span className={styles.count}>
            {data.hasMoreActivity
              ? "25 aktivitas dimuat"
              : `${data.activity.length} aktivitas`}
          </span>
        </div>
        <label className={styles.periodControl}>
          Periode aktivitas
          <select
            value={data.period}
            onChange={(event) => onPeriod(event.target.value as MonitorPeriod)}
          >
            <option value="today">Hari ini</option>
            <option value="week">7 hari terakhir</option>
            <option value="month">Bulan ini</option>
          </select>
        </label>
        <p className={styles.scopeNote}>
          Periode mengikuti WITA. 7 hari mencakup hari ini dan 6 hari
          sebelumnya. Catatan disimpan sekitar 30 hari; awal bulan yang berisi
          31 hari bisa sudah terhapus. Angka pemakaian di atas tetap untuk bulan
          ini.
        </p>
        <div className={styles.toolbar}>
          <div className={styles.searchBox}>
            <Search size={17} aria-hidden="true" />
            <label htmlFor="scan-search" className="sr-only">
              Cari aktivitas scan yang dimuat
            </label>
            <input
              id="scan-search"
              type="search"
              placeholder="Cari akun, ID tagihan, model…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <label className={styles.selectLabel}>
            <span className="sr-only">Filter hasil scan</span>
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="all">Semua hasil</option>
              {states.map((state) => (
                <option key={state.key} value={state.key}>
                  {state.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className={styles.scopeNote} role="status">
          Menampilkan {filtered.length} dari {data.activity.length} aktivitas
          yang dimuat. Cari dan filter berlaku untuk data ini.
        </p>
        {filtered.length ? (
          <>
            <div
              className={styles.desktopTable}
              tabIndex={0}
              role="region"
              aria-label="Aktivitas scan yang dapat digulir"
            >
              <table className={styles.table}>
                <caption className="sr-only">
                  Aktivitas scan terbaru, dari yang paling baru
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Waktu mulai</th>
                    <th scope="col">Pengguna</th>
                    <th scope="col">Hasil</th>
                    <th scope="col">Model</th>
                    <th scope="col">Durasi</th>
                    <th scope="col">
                      <span className="sr-only">Detail</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((scan) => (
                    <tr key={scan.id}>
                      <td className={styles.dateCell}>
                        {dateLabel(scan.reservedAt)}
                      </td>
                      <td>
                        <div className={styles.personCell}>
                          <strong>{scan.displayName}</strong>
                          <span>
                            {scan.email || "Data akun tidak tersedia"}
                          </span>
                        </div>
                      </td>
                      <td>
                        <StatusBadge
                          state={scanState(scan, data.evaluatedAt)}
                        />
                        <ScanExplanation
                          compact
                          scan={scan}
                          now={data.evaluatedAt}
                        />
                        {scan.errorCode && (
                          <small className={styles.cellNote}>
                            {scan.errorCode}
                          </small>
                        )}
                      </td>
                      <td>
                        <span className={styles.modelName}>{scan.model}</span>
                      </td>
                      <td className={styles.dateCell}>{durationLabel(scan)}</td>
                      <td>
                        <button
                          type="button"
                          className={styles.rowButton}
                          onClick={() => setSelected(scan)}
                          aria-label={`Detail scan ${scan.id}`}
                        >
                          Detail <ArrowUpRight size={14} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.mobileCards}>
              {filtered.map((scan) => (
                <article className={styles.scanCard} key={scan.id}>
                  <div className={styles.row}>
                    <span className={styles.muted}>
                      {dateLabel(scan.reservedAt)}
                    </span>
                    <StatusBadge state={scanState(scan, data.evaluatedAt)} />
                  </div>
                  <div className={styles.personCell}>
                    <h3>{scan.displayName}</h3>
                    <span>{scan.email || "Data akun tidak tersedia"}</span>
                  </div>
                  <ScanExplanation compact scan={scan} now={data.evaluatedAt} />
                  <div className={styles.row}>
                    <span className={styles.muted}>
                      {scan.model} · {durationLabel(scan)}
                    </span>
                    <button
                      type="button"
                      className={styles.rowButton}
                      onClick={() => setSelected(scan)}
                      aria-label={`Detail scan ${scan.id}`}
                    >
                      Detail <ArrowUpRight size={14} aria-hidden="true" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className={styles.empty}>
            <ScanLine size={30} aria-hidden="true" />
            <h3>
              {data.activity.length
                ? "Aktivitas tidak ditemukan"
                : "Belum ada aktivitas scan"}
            </h3>
            <p>
              {data.activity.length
                ? "Coba pencarian lain atau pilih semua hasil."
                : "Percobaan membaca struk akan muncul di sini. Tagihan manual tidak menggunakan scan."}
            </p>
            {data.activity.length > 0 && (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  setSearch("");
                  setFilter("all");
                }}
              >
                Reset pencarian
              </button>
            )}
          </div>
        )}
        <div className={styles.panelFootnote}>
          <CheckCircle2 size={15} aria-hidden="true" />
          <p>
            Foto struk dan isi pesanan tidak ditampilkan. Status belum selesai
            lebih dari satu menit ditandai “Perlu dicek”, bukan otomatis
            dianggap gagal.
          </p>
        </div>
      </section>
      {selected && (
        <AdminDialog
          title="Detail aktivitas scan"
          eyebrow="AKTIVITAS SCAN"
          description={selected.displayName}
          onClose={() => setSelected(null)}
        >
          <ScanDetails scan={selected} now={data.evaluatedAt} />
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => setSelected(null)}
          >
            Tutup detail
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={!selected.email}
            onClick={() => {
              const uid = selected.ownerUid;
              setSelected(null);
              onSelectUser(uid);
            }}
          >
            Buka profil pengguna
          </button>
        </AdminDialog>
      )}
    </>
  );
}
