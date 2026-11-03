"use client";

import { useState, useTransition } from "react";
import {
  ArrowDownUp,
  ChevronRight,
  Copy,
  CreditCard,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { updateAccountAction } from "@/app/actions/access";
import { AdminDialog } from "./AdminDialog";
import type { SearchField } from "@/server/admin/data";
import { AdminPreparation } from "./AdminPreparation";
import {
  accountState,
  dateLabel,
  fromWitaInput,
  monthLabel,
  numberLabel,
  sourceLabel,
  toWitaInput,
  type ManagedUser,
  type MessageHandler,
  type Quota,
} from "./admin-utils";
import styles from "./admin.module.css";

export function StatusBadge(
  props:
    | { label: string; tone: string }
    | { state: { label: string; tone: string } },
) {
  const { label, tone } = "state" in props ? props.state : props;
  return (
    <span className={styles.badge} data-tone={tone}>
      <span aria-hidden="true" />
      {label}
    </span>
  );
}

function UsageMeter({ quota }: { quota: Quota }) {
  const total = quota.monthlyLimit + quota.bonus;
  return (
    <div className={styles.usageCell}>
      <div>
        <strong>{numberLabel(quota.usedThisMonth)}</strong>
        <span> / {numberLabel(total)} scan</span>
      </div>
      <progress
        max={Math.max(1, total)}
        value={Math.min(quota.usedThisMonth, Math.max(1, total))}
        data-low={quota.remaining === 0}
        aria-label={`${quota.usedThisMonth} dari ${total} scan terpakai`}
      />
    </div>
  );
}

export function UserManagement({
  users,
  quotas,
  nowMs,
  onSelect,
  searchField,
  searchQuery,
  onSearch,
  onPrepared,
}: {
  users: ManagedUser[];
  quotas: Array<Quota & { uid: string }>;
  nowMs: number;
  onSelect: (uid: string) => void;
  searchField: SearchField;
  searchQuery: string;
  onSearch: (field: SearchField, query: string) => void;
  onPrepared: () => void;
}) {
  const [search, setSearch] = useState(searchQuery);
  const [field, setField] = useState(searchField);
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("recent");
  const quotaMap = new Map(quotas.map((quota) => [quota.uid, quota]));
  const filtered = users
    .filter((user) => {
      const state = accountState(user, nowMs);
      const quota = quotaMap.get(user.uid);
      const matchesStatus =
        filter === "all" ||
        filter === state.key ||
        (filter === "low" && quota && quota.remaining <= 5);
      return matchesStatus;
    })
    .sort((a, b) =>
      sort === "name"
        ? a.displayName.localeCompare(b.displayName, "id")
        : sort === "usage"
          ? (quotaMap.get(b.uid)?.usedThisMonth ?? 0) -
            (quotaMap.get(a.uid)?.usedThisMonth ?? 0)
          : sort === "remaining"
            ? (quotaMap.get(a.uid)?.remaining ?? 0) -
              (quotaMap.get(b.uid)?.remaining ?? 0)
            : b.updatedAt.localeCompare(a.updatedAt),
    );

  return (
    <section className={styles.panel} aria-labelledby="accounts-heading">
      <div className={styles.panelHeading}>
        <div>
          <h2 id="accounts-heading">Pengguna & kuota</h2>
          <p>Periksa akses, pemakaian, dan bonus scan tiap akun.</p>
        </div>
        <span className={styles.count}>{users.length} akun dimuat</span>
      </div>
      <form
        className={styles.globalSearch}
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(field, search.trim());
        }}
      >
        <label>
          Cari berdasarkan
          <select
            value={field}
            onChange={(event) => setField(event.target.value as SearchField)}
          >
            <option value="email">Email</option>
            <option value="name">Nama</option>
            <option value="uid">UID lengkap</option>
          </select>
        </label>
        <div className={styles.searchBox}>
          <Search size={17} aria-hidden="true" />
          <label className="sr-only" htmlFor="account-search">
            Cari pengguna di seluruh database
          </label>
          <input
            id="account-search"
            type="search"
            placeholder={
              field === "uid"
                ? "Masukkan UID lengkap"
                : "Ketik awal nama atau email…"
            }
            minLength={field === "uid" ? 1 : 2}
            maxLength={254}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <button type="submit" className={styles.primaryButton}>
          Cari
        </button>
        {searchQuery && (
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => onSearch(searchField, "")}
          >
            Hapus pencarian
          </button>
        )}
      </form>
      <p className={styles.scopeNote}>
        Pencarian mencakup seluruh akun. Nama dan email dicari dari awal teks;
        UID harus lengkap.
      </p>
      <div className={styles.toolbar}>
        <label className={styles.selectLabel}>
          <span className="sr-only">Filter status pengguna</span>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">Semua status</option>
            <option value="active">Aktif</option>
            <option value="pending">Menunggu akses</option>
            <option value="disabled">Nonaktif</option>
            <option value="expired">Akses berakhir</option>
            <option value="admin">Admin</option>
            <option value="low">Sisa ≤ 5 scan</option>
          </select>
        </label>
        <label className={styles.selectLabel}>
          <ArrowDownUp size={15} aria-hidden="true" />
          <span className="sr-only">Urutkan pengguna</span>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="recent">Terakhir diubah</option>
            <option value="usage">Scan terbanyak</option>
            <option value="remaining">Sisa paling sedikit</option>
            <option value="name">Nama A–Z</option>
          </select>
        </label>
      </div>
      <p className={styles.scopeNote} role="status">
        {filtered.length} dari {users.length} akun pada halaman ini. Filter
        status dan urutan berlaku untuk halaman ini.
      </p>
      {filtered.length ? (
        <>
          <div
            className={styles.desktopTable}
            tabIndex={0}
            role="region"
            aria-label="Daftar pengguna yang dapat digulir"
          >
            <table className={styles.table}>
              <caption className="sr-only">
                Pengguna, akses, pemakaian, dan sisa kuota scan bulan ini
              </caption>
              <thead>
                <tr>
                  <th scope="col">Pengguna</th>
                  <th scope="col">Status akses</th>
                  <th scope="col">Pemakaian bulan ini</th>
                  <th scope="col">Sisa</th>
                  <th scope="col">Terakhir diubah</th>
                  <th scope="col">
                    <span className="sr-only">Tindakan</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => {
                  const quota = quotaMap.get(user.uid);
                  const state = accountState(user, nowMs);
                  return (
                    <tr key={user.uid}>
                      <td>
                        <div className={styles.identity}>
                          <span className={styles.avatar} aria-hidden="true">
                            {user.displayName.slice(0, 2).toUpperCase()}
                          </span>
                          <div>
                            <strong>{user.displayName}</strong>
                            <span>{user.email}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <StatusBadge state={state} />
                        <small className={styles.cellNote}>
                          {user.isAdmin
                            ? "Admin deployment"
                            : user.accessUntil
                              ? dateLabel(user.accessUntil)
                              : "Tanpa batas waktu"}
                        </small>
                      </td>
                      <td>
                        {quota ? (
                          <>
                            <UsageMeter quota={quota} />
                            <small className={styles.cellNote}>
                              {quota.monthlyLimit} bulanan + {quota.bonus} bonus
                            </small>
                          </>
                        ) : (
                          <span>Kuota belum tersedia</span>
                        )}
                      </td>
                      <td>
                        <strong
                          className={styles.remaining}
                          data-low={quota?.remaining === 0}
                        >
                          {quota ? numberLabel(quota.remaining) : "—"}
                        </strong>
                        <small className={styles.cellNote}>scan</small>
                      </td>
                      <td className={styles.dateCell}>
                        {dateLabel(user.updatedAt)}
                      </td>
                      <td>
                        <button
                          className={styles.rowButton}
                          type="button"
                          disabled={!quota}
                          onClick={() => onSelect(user.uid)}
                          aria-label={`Kelola ${user.displayName}`}
                        >
                          Kelola <ChevronRight size={15} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className={styles.mobileCards}>
            {filtered.map((user) => {
              const quota = quotaMap.get(user.uid);
              const state = accountState(user, nowMs);
              return (
                <article className={styles.userCard} key={user.uid}>
                  <div className={styles.row}>
                    <div className={styles.identity}>
                      <span className={styles.avatar} aria-hidden="true">
                        {user.displayName.slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <h3>{user.displayName}</h3>
                        <span>{user.email}</span>
                      </div>
                    </div>
                    <StatusBadge state={state} />
                  </div>
                  {quota && (
                    <>
                      <UsageMeter quota={quota} />
                      <div className={styles.row}>
                        <span className={styles.muted}>
                          {quota.monthlyLimit} bulanan + {quota.bonus} bonus
                        </span>
                        <strong>{quota.remaining} scan tersisa</strong>
                      </div>
                    </>
                  )}
                  <div className={styles.mobileCardFooter}>
                    <span className={styles.muted}>
                      {user.isAdmin
                        ? "Admin deployment"
                        : user.accessUntil
                          ? `Sampai ${dateLabel(user.accessUntil)}`
                          : "Akses tanpa batas waktu"}
                    </span>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      disabled={!quota}
                      onClick={() => onSelect(user.uid)}
                      aria-label={`Kelola ${user.displayName}`}
                    >
                      <CreditCard size={16} aria-hidden="true" /> Kelola akun &
                      bonus
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      ) : (
        <div className={styles.empty}>
          <Users size={30} aria-hidden="true" />
          <h3>Tidak ada akun yang cocok</h3>
          <p>Coba nama lain atau ubah filter pada halaman ini.</p>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => {
              onSearch(searchField, "");
              setFilter("all");
            }}
          >
            Reset pencarian
          </button>
        </div>
      )}
      <AdminPreparation onPrepared={onPrepared} />
    </section>
  );
}

export function UserEditor({
  user,
  quota,
  nowMs,
  onClose,
  onMessage,
  onChanged,
  embedded = false,
  onBusyChange,
}: {
  user: ManagedUser;
  quota: Quota;
  nowMs: number;
  onClose: () => void;
  onMessage: MessageHandler;
  onChanged: () => void;
  embedded?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState(user.status);
  const [until, setUntil] = useState(toWitaInput(user.accessUntil));
  const [limit, setLimit] = useState(String(user.monthlyLimit));
  const [bonus, setBonus] = useState(String(quota.bonus));
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const needsConfirmation =
    (status === "disabled" && user.status !== "disabled") ||
    Number(limit) + Number(bonus) < quota.monthlyLimit + quota.bonus;
  const state = accountState(user, nowMs);
  const validNumbers =
    limit !== "" &&
    bonus !== "" &&
    Number.isSafeInteger(Number(limit)) &&
    Number.isSafeInteger(Number(bonus)) &&
    Number(limit) >= 0 &&
    Number(limit) <= 10000 &&
    Number(bonus) >= 0 &&
    Number(bonus) <= 10000;
  const remaining = Math.max(
    0,
    Number(limit) + Number(bonus) - quota.usedThisMonth,
  );
  const content = (
    <>
      <div className={styles.row}>
        <StatusBadge state={state} />
        <span className={styles.muted}>{monthLabel(quota.monthKey)}</span>
      </div>
      <div className={styles.editorUsage}>
        <div>
          <span>Sudah dipakai</span>
          <strong>
            {quota.usedThisMonth}
            <small> scan</small>
          </strong>
        </div>
        <div>
          <span>Sisa saat ini</span>
          <strong>
            {quota.remaining}
            <small> scan</small>
          </strong>
        </div>
      </div>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (needsConfirmation && !confirmed) return;
          setError(null);
          onBusyChange?.(true);
          startTransition(async () => {
            try {
              const response = await updateAccountAction({
                uid: user.uid,
                status: user.isAdmin ? "active" : status,
                accessUntil: user.isAdmin ? null : fromWitaInput(until),
                monthlyLimit: Number(limit),
                bonus: Number(bonus),
                usageMonth: quota.monthKey,
                expectedUpdatedAt: user.updatedAt,
                expectedBonus: quota.bonus,
              });
              if (!response.ok) {
                setError(response.error);
                return;
              }
              onMessage(`Pengaturan ${user.displayName} tersimpan.`);
              onClose();
              onChanged();
            } catch {
              setError(
                "Belum berhasil menyimpan. Periksa koneksi dan coba lagi.",
              );
            } finally {
              onBusyChange?.(false);
            }
          });
        }}
      >
        <fieldset disabled={pending} className={styles.fieldset}>
          <legend>Jatah & bonus scan</legend>
          <label>
            Jatah setiap bulan
            <input
              type="number"
              required
              min={0}
              max={10000}
              step={1}
              inputMode="numeric"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
            />
            <small>Berlaku untuk bulan ini dan bulan berikutnya.</small>
          </label>
          <label>
            Total bonus {monthLabel(quota.monthKey)}
            <input
              type="number"
              required
              min={0}
              max={10000}
              step={1}
              inputMode="numeric"
              value={bonus}
              onChange={(event) => setBonus(event.target.value)}
            />
            <small>
              Bonus hanya berlaku bulan ini. Pemakaian tidak direset.
            </small>
          </label>
          <div
            className={styles.quickAdd}
            aria-label="Tambah bonus ke nilai yang akan disimpan"
          >
            {[5, 10, 25].map((amount) => (
              <button
                type="button"
                key={amount}
                disabled={!validNumbers || Number(bonus) + amount > 10000}
                onClick={() => setBonus(String(Number(bonus) + amount))}
              >
                +{amount} scan
              </button>
            ))}
            <button type="button" onClick={() => setBonus(String(quota.bonus))}>
              Reset
            </button>
          </div>
          <div className={styles.changePreview} aria-live="polite">
            <span>Perkiraan sisa setelah disimpan</span>
            <strong>
              {validNumbers
                ? `${numberLabel(remaining)} scan`
                : "Periksa angka"}
            </strong>
            <small>
              {validNumbers
                ? `${numberLabel(Number(limit))} bulanan + ${numberLabel(Number(bonus))} bonus − ${numberLabel(quota.usedThisMonth)} terpakai`
                : "Isi angka bulat dari 0 sampai 10.000."}
            </small>
          </div>
        </fieldset>
        <fieldset disabled={pending} className={styles.fieldset}>
          <legend>Akses akun</legend>
          {user.isAdmin ? (
            <p className={styles.inlineNote}>
              <ShieldCheck size={18} aria-hidden="true" /> Akses admin dikelola
              melalui konfigurasi deployment. Jatah dan bonus tetap dapat
              diubah.
            </p>
          ) : (
            <>
              <label>
                Status akses
                <select
                  value={status}
                  onChange={(event) =>
                    setStatus(event.target.value as ManagedUser["status"])
                  }
                >
                  {user.status === "pending" && (
                    <option value="pending">Menunggu akses</option>
                  )}
                  <option value="active">Aktif</option>
                  <option value="disabled">Nonaktif</option>
                </select>
              </label>
              <label>
                Akses sampai (WITA)
                <input
                  type="datetime-local"
                  value={until}
                  onChange={(event) => setUntil(event.target.value)}
                />
                <small>Kosongkan untuk akses tanpa batas waktu.</small>
              </label>
              {status === "disabled" && (
                <p className={styles.warningNote}>
                  Akses aplikasi dan link publik akun ini akan ditutup. Data
                  tagihan tetap disimpan.
                </p>
              )}
            </>
          )}
        </fieldset>
        <section
          className={styles.detailSection}
          aria-label="Detail akun lengkap"
        >
          <h3>Detail akun</h3>
          <dl className={styles.detailList}>
            <div>
              <dt>Nama pengguna</dt>
              <dd>{user.displayName}</dd>
            </div>
            <div>
              <dt>Email pengguna</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>Terdaftar</dt>
              <dd>{dateLabel(user.createdAt)}</dd>
            </div>
            <div>
              <dt>Diaktifkan</dt>
              <dd>{dateLabel(user.activatedAt, "Belum diaktifkan")}</dd>
            </div>
            <div>
              <dt>Terakhir diubah</dt>
              <dd>{dateLabel(user.updatedAt)}</dd>
            </div>
            <div>
              <dt>Sumber akses</dt>
              <dd>{sourceLabel(user.source)}</dd>
            </div>
            <div>
              <dt>ID akun</dt>
              <dd>
                <code>{user.uid}</code>
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(user.uid);
                      setCopied(true);
                    } catch {
                      setError(
                        "ID belum bisa disalin. Pilih teks ID untuk menyalin manual.",
                      );
                    }
                  }}
                >
                  <Copy size={13} aria-hidden="true" />
                  {copied ? "Tersalin" : "Salin ID"}
                </button>
              </dd>
            </div>
          </dl>
        </section>
        {error && (
          <p className={styles.errorNote} role="alert">
            {error}
          </p>
        )}
        {needsConfirmation && (
          <label className={styles.confirmChange}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              Saya memahami perubahan untuk {user.email}:{" "}
              {status === "disabled" && user.status !== "disabled"
                ? "akses aplikasi dan link publik akan ditutup. "
                : ""}
              {Number(limit) + Number(bonus) < quota.monthlyLimit + quota.bonus
                ? "Jatah scan berkurang; pemakaian tetap dihitung."
                : ""}
            </span>
          </label>
        )}
        <div className={styles.formFooter}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onClose}
            disabled={pending}
          >
            Batal
          </button>
          <button
            className={styles.primaryButton}
            disabled={
              pending || !validNumbers || (needsConfirmation && !confirmed)
            }
          >
            {pending ? "Menyimpan…" : "Simpan perubahan"}
          </button>
        </div>
      </form>
    </>
  );
  return embedded ? (
    content
  ) : (
    <AdminDialog
      title={user.displayName}
      description={user.email}
      onClose={onClose}
      busy={pending}
    >
      {content}
    </AdminDialog>
  );
}
