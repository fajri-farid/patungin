"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { ArrowLeft, ChevronRight, FileClock, RefreshCw } from "lucide-react";
import { loadLogsPage } from "@/app/actions/admin";
import type {
  LogsPage,
  LogQuery,
  SafeAudit,
  SafeEvent,
} from "@/server/admin/logs";
import type { AdminScanActivity } from "@/server/admin/monitoring";
import type { MonitorPeriod } from "@/server/admin/pagination";
import {
  diagnoseCode,
  diagnoseScan,
  repeatedFlag,
  type DiagnosticLevel,
} from "@/domain/diagnostics";
import { AdminDialog } from "../AdminDialog";
import { AdminPager } from "../AdminPager";
import { ScanDetails } from "../ScanDetails";
import { StatusBadge } from "../UserManagement";
import { UserProfile } from "../UserProfile";
import { dateLabel, scanState } from "../admin-utils";
import styles from "../admin.module.css";
import ui from "@/components/product/product.module.css";

const CATEGORIES = [
  { id: "scans", label: "Scan" },
  { id: "changes", label: "Perubahan admin" },
  { id: "events", label: "Penolakan & gangguan" },
] as const;
const LEVELS: Record<DiagnosticLevel, { label: string; tone: string }> = {
  normal: { label: "Normal", tone: "muted" },
  attention: { label: "Perhatian", tone: "amber" },
  error: { label: "Gangguan", tone: "red" },
  security: { label: "Keamanan", tone: "red" },
};
const STAGES: Record<string, string> = {
  validation: "Validasi permintaan",
  quota: "Pemeriksaan kuota & akses",
  provider: "Pembacaan AI",
  persistence: "Penyimpanan hasil",
  account: "Perubahan akun",
  admin_read: "Pemuatan data admin",
  bill: "Pengelolaan tagihan",
};
const scanFilters = [
  { id: "all", label: "Semua hasil" },
  { id: "failed", label: "Gagal" },
  { id: "unknown", label: "Hasil tidak pasti / timeout" },
  { id: "processing", label: "Belum mencatat penyelesaian" },
  { id: "not_applied", label: "Hasil tidak diterapkan" },
];
const eventFilters = [
  { id: "all", label: "Semua tingkat" },
  { id: "normal", label: "Normal / ditolak sesuai aturan" },
  { id: "attention", label: "Perlu perhatian" },
  { id: "error", label: "Gangguan" },
  { id: "security", label: "Keamanan" },
];
type Selection =
  | { type: "scan"; scan: AdminScanActivity }
  | { type: "audit"; audit: SafeAudit }
  | { type: "event"; event: SafeEvent };
const keyFor = (q: LogQuery) =>
  JSON.stringify([q.category, q.period, q.filter ?? "all", q.after ?? ""]);
const booleanLabel = (value: boolean | null) =>
  value === true ? "Ya" : value === false ? "Tidak" : "Belum dapat dipastikan";

function AuditChanges({ audit }: { audit: SafeAudit }) {
  const labels = {
    status: "Status akses",
    accessUntil: "Akses sampai",
    monthlyLimit: "Jatah bulanan",
    bonus: `Bonus ${audit.monthKey}`,
  };
  const label = (field: keyof typeof labels, value: string | number | null) =>
    field === "accessUntil"
      ? dateLabel(value as string | null)
      : field === "status"
        ? value === "active"
          ? "Aktif"
          : value === "pending"
            ? "Menunggu akses"
            : "Nonaktif"
        : `${value} scan`;
  return (
    <dl className={styles.detailList}>
      {(Object.keys(labels) as Array<keyof typeof labels>)
        .filter((field) => audit.before[field] !== audit.after[field])
        .map((field) => (
          <div key={field}>
            <dt>{labels[field]}</dt>
            <dd>
              {label(field, audit.before[field])} →{" "}
              <strong>{label(field, audit.after[field])}</strong>
            </dd>
          </div>
        ))}
    </dl>
  );
}

export function LogsClient({
  initial,
  initialQuery,
}: {
  initial: LogsPage;
  initialQuery: LogQuery;
}) {
  const [page, setPage] = useState(initial);
  const [query, setQuery] = useState(initialQuery);
  const [period, setPeriod] = useState(initialQuery.period);
  const [filter, setFilter] = useState(initialQuery.filter ?? "all");
  const [history, setHistory] = useState<LogQuery[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const cache = useRef(
    new Map([
      [keyFor(initialQuery), { page: initial, at: initial.evaluatedAt }],
    ]),
  );
  const serial = useRef(0);
  function load(
    target: LogQuery,
    navigation: "reset" | "next" | "previous" = "reset",
    force = false,
  ) {
    const id = ++serial.current;
    setError(null);
    startTransition(async () => {
      const key = keyFor(target);
      const saved = cache.current.get(key);
      try {
        const result =
          !force && saved && Date.now() - saved.at < 60000
            ? { ok: true as const, data: saved.page }
            : await loadLogsPage(target);
        if (id !== serial.current) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (cache.current.size >= 12)
          cache.current.delete(cache.current.keys().next().value!);
        cache.current.set(key, { page: result.data, at: Date.now() });
        setPage(result.data);
        setQuery(target);
        setFilter(target.filter ?? "all");
        setPeriod(target.period);
        setHistory((old) =>
          navigation === "next"
            ? [...old, query]
            : navigation === "previous"
              ? old.slice(0, -1)
              : [],
        );
      } catch {
        if (id === serial.current)
          setError("Log belum dapat dimuat. Coba perbarui lagi.");
      }
    });
  }
  const categories = page.category === "scans" ? scanFilters : eventFilters;
  const count =
    page.category === "scans"
      ? page.scans.length
      : page.category === "changes"
        ? page.records.length
        : page.events.length;
  const selectedUid =
    selected?.type === "scan"
      ? selected.scan.ownerUid
      : selected?.type === "audit"
        ? selected.audit.ownerUid
        : (selected?.event.subjectUid ?? selected?.event.ownerUid);
  return (
    <div className={ui.page}>
      <header className={styles.adminHeader}>
        <div className={styles.adminHeaderInner}>
          <Link href="/admin" prefetch={false} className={styles.adminBrand}>
            <span>
              <FileClock size={20} aria-hidden="true" />
            </span>
            <strong>Patungin</strong>
            <small>Log</small>
          </Link>
          <Link href="/admin" prefetch={false} className={styles.backLink}>
            <ArrowLeft size={16} aria-hidden="true" /> Kembali ke admin
          </Link>
        </div>
      </header>
      <main className={styles.shell}>
        <div className={styles.intro}>
          <div>
            <p className={styles.eyebrow}>CATATAN OPERASIONAL</p>
            <h1>Apa yang terjadi. Apa langkahnya.</h1>
            <p>Telusuri hasil scan, perubahan akses, dan gangguan penting.</p>
          </div>
          <div className={styles.introActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={pending}
              onClick={() => {
                cache.current.clear();
                load({ ...query, after: undefined }, "reset", true);
              }}
            >
              <RefreshCw size={16} aria-hidden="true" />
              {pending ? "Memuat…" : "Perbarui log"}
            </button>
          </div>
        </div>
        <div className={styles.pageMeta}>
          <span>
            Diperbarui {dateLabel(new Date(page.evaluatedAt).toISOString())}
          </span>
          <span>Semua waktu mengikuti WITA</span>
        </div>
        {error && (
          <p role="alert" className={styles.errorNote}>
            {error}
          </p>
        )}
        {feedback && (
          <p role="status" className={styles.inlineNote}>
            {feedback}
          </p>
        )}
        <div
          className={styles.tabs}
          role="tablist"
          aria-label="Kategori log"
          onKeyDown={(event) => {
            if (
              pending ||
              !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
            )
              return;
            event.preventDefault();
            const current = CATEGORIES.findIndex((c) => c.id === page.category);
            const index =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? 2
                  : (current + (event.key === "ArrowRight" ? 1 : -1) + 3) % 3;
            load({
              category: CATEGORIES[index].id,
              period: query.period,
              filter: "all",
            });
            document.getElementById(`log-tab-${CATEGORIES[index].id}`)?.focus();
          }}
        >
          {CATEGORIES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`log-tab-${id}`}
              aria-controls={`log-panel-${id}`}
              aria-selected={page.category === id}
              aria-disabled={pending}
              tabIndex={page.category === id ? 0 : -1}
              onClick={() => {
                if (!pending)
                  load({ category: id, period: query.period, filter: "all" });
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <section
          role="tabpanel"
          id={`log-panel-${page.category}`}
          aria-labelledby={`log-tab-${page.category}`}
          aria-busy={pending}
          className={styles.panel}
        >
          <div className={styles.panelHeading}>
            <div>
              <h2>{CATEGORIES.find((c) => c.id === page.category)!.label}</h2>
              <p>
                {page.category === "scans"
                  ? "Hasil scan dan penerapannya ke draft."
                  : page.category === "changes"
                    ? "Perubahan akses dan kuota oleh admin sejak pencatatan diaktifkan."
                    : "Permintaan yang ditolak dan gangguan yang perlu ditelusuri."}
              </p>
            </div>
            <span className={styles.count}>{count} catatan dimuat</span>
          </div>
          <form
            className={styles.logFilters}
            onSubmit={(event) => {
              event.preventDefault();
              load({ category: page.category, period, filter });
            }}
          >
            <label>
              Periode
              <select
                disabled={pending}
                value={period}
                onChange={(event) =>
                  setPeriod(event.target.value as MonitorPeriod)
                }
              >
                <option value="today">Hari ini</option>
                <option value="week">7 hari terakhir</option>
                <option value="month">Bulan ini</option>
              </select>
            </label>
            {page.category !== "changes" && (
              <label>
                {page.category === "scans" ? "Hasil scan" : "Tingkat kejadian"}
                <select
                  disabled={pending}
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                >
                  {categories.map(({ id, label }) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="submit"
              disabled={pending}
              className={styles.primaryButton}
            >
              Terapkan filter
            </button>
          </form>
          <p className={styles.scopeNote}>
            {page.category === "scans"
              ? "Filter mencakup seluruh catatan scan yang masih tersimpan. Catatan lama mungkin belum menyimpan alasan hasil tidak diterapkan."
              : page.category === "events"
                ? "Penolakan berulang diringkas dalam jendela 5 menit. Jumlah yang ditampilkan adalah minimum yang sempat tersimpan, bukan total pasti seluruh request."
                : "Nilai sebelum dan sesudah perubahan disimpan bersama transaksi pengaturan akun. Aktivasi otomatis lewat undangan tidak termasuk perubahan admin."}
          </p>
          <div className={styles.logList}>
            {page.category === "scans" &&
              page.scans.map((scan) => {
                const d = diagnoseScan(scan, page.evaluatedAt);
                return (
                  <article
                    className={styles.logRow}
                    data-level={d.level}
                    key={scan.id}
                  >
                    <div className={styles.logTime}>
                      <time>{dateLabel(scan.reservedAt)}</time>
                      <StatusBadge state={scanState(scan, page.evaluatedAt)} />
                    </div>
                    <div className={styles.logContent}>
                      <h3>{d.title}</h3>
                      <p>
                        {scan.displayName} ·{" "}
                        {scan.email ?? "Akun tidak tersedia"}
                      </p>
                      <span>{d.explanation}</span>
                      <code>{d.flag}</code>
                    </div>
                    <button
                      type="button"
                      className={styles.rowButton}
                      aria-label={`Detail log scan ${scan.id}`}
                      onClick={() => setSelected({ type: "scan", scan })}
                    >
                      Detail <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </article>
                );
              })}
            {page.category === "changes" &&
              page.records.map((audit) => (
                <article
                  className={styles.logRow}
                  data-level="normal"
                  key={audit.id}
                >
                  <div className={styles.logTime}>
                    <time>{dateLabel(audit.createdAt)}</time>
                    <StatusBadge label="Perubahan admin" tone="blue" />
                  </div>
                  <div className={styles.logContent}>
                    <h3>Pengaturan akses atau kuota diubah</h3>
                    <p>Oleh {audit.actorEmail}</p>
                    <span>Akun: {audit.ownerUid}</span>
                    <AuditChanges audit={audit} />
                  </div>
                  <button
                    type="button"
                    className={styles.rowButton}
                    aria-label={`Detail perubahan ${audit.id}`}
                    onClick={() => setSelected({ type: "audit", audit })}
                  >
                    Detail <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </article>
              ))}
            {page.category === "events" &&
              page.events.map((event) => {
                const d = diagnoseCode(event.code);
                return (
                  <article
                    className={styles.logRow}
                    data-level={event.level}
                    key={event.id}
                  >
                    <div className={styles.logTime}>
                      <time>{dateLabel(event.firstAt)}</time>
                      <StatusBadge
                        state={
                          LEVELS[event.level as DiagnosticLevel] ??
                          LEVELS.attention
                        }
                      />
                      {event.count > 1 && (
                        <small>Minimal {event.count} kejadian tercatat</small>
                      )}
                    </div>
                    <div className={styles.logContent}>
                      <h3>{d.title}</h3>
                      <p>
                        {STAGES[event.stage] ?? "Tahap belum dikenal"} ·{" "}
                        {event.ownerUid}
                      </p>
                      <span>{d.explanation}</span>
                      <code>
                        {d.flag}
                        {repeatedFlag(event.code, event.count)
                          ? ` · ${repeatedFlag(event.code, event.count)}`
                          : ""}
                      </code>
                    </div>
                    <button
                      type="button"
                      className={styles.rowButton}
                      aria-label={`Detail kejadian ${event.id}`}
                      onClick={() => setSelected({ type: "event", event })}
                    >
                      Detail <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </article>
                );
              })}
          </div>
          {!count && (
            <div className={styles.empty}>
              <FileClock size={28} aria-hidden="true" />
              <h3>Belum ada catatan untuk filter ini</h3>
              <p>
                Coba periode atau filter lain. Penolakan dan gangguan mulai
                dicatat sejak fitur ini dipasang.
              </p>
            </div>
          )}
          <div className={styles.panelFootnote}>
            <p>
              {page.category === "changes"
                ? "Riwayat perubahan disimpan hingga 1 tahun."
                : "Retensi scan dan gangguan sekitar 30 hari. Sebagian catatan bisa terhapus lebih awal saat tagihan dihapus. Gangguan yang tidak dapat ditulis ke database perlu diperiksa di log hosting."}
            </p>
          </div>
        </section>
        {CATEGORIES.filter((c) => c.id !== page.category).map(({ id }) => (
          <div
            key={id}
            role="tabpanel"
            id={`log-panel-${id}`}
            aria-labelledby={`log-tab-${id}`}
            hidden
          />
        ))}
        <div className={styles.logPagination}>
          <AdminPager
            next={page.next}
            hasPrevious={history.length > 0}
            busy={pending}
            onNext={() => load({ ...query, after: page.next! }, "next")}
            onPrevious={() => load(history.at(-1)!, "previous")}
          />
        </div>
      </main>
      {selected && (
        <AdminDialog
          eyebrow="LOG AKTIVITAS"
          title={
            selected.type === "scan"
              ? "Detail hasil scan"
              : selected.type === "audit"
                ? "Detail perubahan admin"
                : "Detail penolakan / gangguan"
          }
          onClose={() => setSelected(null)}
        >
          {selected.type === "scan" ? (
            <ScanDetails scan={selected.scan} now={page.evaluatedAt} />
          ) : selected.type === "audit" ? (
            <>
              <p>
                Perubahan oleh <strong>{selected.audit.actorEmail}</strong> pada{" "}
                {dateLabel(selected.audit.createdAt)}.
              </p>
              <AuditChanges audit={selected.audit} />
              <section
                className={styles.detailSection}
                aria-label="Rincian perubahan lengkap"
              >
                <h3>Rincian perubahan</h3>
                <dl className={styles.detailList}>
                  <div>
                    <dt>Waktu perubahan</dt>
                    <dd>{dateLabel(selected.audit.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Email admin pelaksana</dt>
                    <dd>{selected.audit.actorEmail}</dd>
                  </div>
                  <div>
                    <dt>ID admin pelaksana</dt>
                    <dd>
                      <code>{selected.audit.actorUid}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>ID akun tujuan</dt>
                    <dd>
                      <code>{selected.audit.ownerUid}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Bulan bonus</dt>
                    <dd>{selected.audit.monthKey}</dd>
                  </div>
                  <div>
                    <dt>ID referensi perubahan</dt>
                    <dd>
                      <code>{selected.audit.id}</code>
                    </dd>
                  </div>
                </dl>
              </section>
            </>
          ) : (
            <EventDetail event={selected.event} />
          )}
          {selectedUid && (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => {
                setUid(selectedUid);
                setSelected(null);
              }}
            >
              Buka profil akun terkait
            </button>
          )}
        </AdminDialog>
      )}
      {uid && (
        <UserProfile
          key={uid}
          uid={uid}
          onClose={() => setUid(null)}
          onMessage={setFeedback}
          onSaved={() => {
            cache.current.clear();
            load({ ...query, after: undefined }, "reset", true);
          }}
        />
      )}
    </div>
  );
}

function EventDetail({ event }: { event: SafeEvent }) {
  const d = diagnoseCode(event.code);
  return (
    <>
      <section className={styles.explanation} data-level={event.level}>
        <strong>{d.title}</strong>
        <p>{d.explanation}</p>
        <dl>
          <div>
            <dt>Dampak permintaan terakhir yang tercatat</dt>
            <dd>
              {["validation", "quota", "provider", "persistence"].includes(
                event.stage,
              ) ? (
                <>
                  Kuota scan aplikasi direservasi:{" "}
                  {booleanLabel(event.quotaReserved)}. Panggilan layanan AI
                  dimulai: {booleanLabel(event.providerCalled)}.
                </>
              ) : event.stage === "admin_read" ? (
                "Data admin belum dapat dimuat. Periksa sumber data sebelum mencoba lagi."
              ) : (
                "Operasi belum berhasil diselesaikan. Periksa keadaan data terbaru sebelum mengulang perubahan."
              )}
            </dd>
          </div>
          <div>
            <dt>Langkah berikutnya</dt>
            <dd>{d.action}</dd>
          </div>
        </dl>
        <code>{d.flag}</code>
      </section>
      <dl className={styles.detailList}>
        <div>
          <dt>Tahap operasi</dt>
          <dd>{STAGES[event.stage] ?? event.stage}</dd>
        </div>
        <div>
          <dt>Pertama tercatat</dt>
          <dd>{dateLabel(event.firstAt)}</dd>
        </div>
        <div>
          <dt>Terakhir tersimpan</dt>
          <dd>{dateLabel(event.lastAt)}</dd>
        </div>
        <div>
          <dt>Jumlah minimum tersimpan</dt>
          <dd>{event.count} kejadian dalam jendela 5 menit</dd>
        </div>
      </dl>
      {event.count >= 5 && event.code !== "DUPLICATE_REQUEST" && (
        <p className={styles.warningNote}>
          Kejadian berulang. Ini tidak membuktikan penyalahgunaan. Periksa retry
          aplikasi, jaringan, dan aktivitas akun.
        </p>
      )}
      <section
        className={styles.detailSection}
        aria-label="Referensi kejadian lengkap"
      >
        <h3>Referensi kejadian</h3>
        <dl className={styles.detailList}>
          <div>
            <dt>Tingkat kejadian</dt>
            <dd>
              {LEVELS[event.level as DiagnosticLevel]?.label ?? "Perhatian"}
            </dd>
          </div>
          <div>
            <dt>Flag kejadian</dt>
            <dd>
              <code>{d.flag}</code>
              {repeatedFlag(event.code, event.count) && (
                <>
                  <br />
                  <code>{repeatedFlag(event.code, event.count)}</code>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>ID catatan kejadian</dt>
            <dd>
              <code>{event.id}</code>
            </dd>
          </div>
          <div>
            <dt>Kode</dt>
            <dd>
              <code>{event.code}</code>
            </dd>
          </div>
          <div>
            <dt>ID referensi permintaan terakhir</dt>
            <dd>
              <code>{event.requestId}</code>
            </dd>
          </div>
          <div>
            <dt>ID akun</dt>
            <dd>{event.ownerUid}</dd>
          </div>
          <div>
            <dt>ID akun tujuan pada kejadian terakhir</dt>
            <dd>{event.subjectUid || "Tidak dicatat untuk kejadian ini"}</dd>
          </div>
          <div>
            <dt>ID scan</dt>
            <dd>{event.attemptId || "Tidak tersedia"}</dd>
          </div>
          <div>
            <dt>ID tagihan</dt>
            <dd>{event.billId || "Tidak tersedia"}</dd>
          </div>
        </dl>
      </section>
    </>
  );
}
