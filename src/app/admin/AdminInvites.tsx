"use client";

import { useState, useTransition } from "react";
import { Copy, MailPlus, Plus, Search } from "lucide-react";
import {
  createInviteAction,
  setInviteActiveAction,
} from "@/app/actions/access";
import type { InviteRecord } from "@/server/access/types";
import { dateLabel, fromWitaInput } from "./admin-utils";
import ui from "@/components/product/product.module.css";
import styles from "./admin.module.css";

export function InvitesPanel({
  invites,
  nowMs,
  onMessage,
  onCreate,
  onChanged,
}: {
  invites: InviteRecord[];
  nowMs: number;
  onMessage: (text: string, error?: boolean) => void;
  onCreate: () => void;
  onChanged: () => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const query = search.trim().toLowerCase();
  const filtered = invites
    .filter((invite) => {
      const available =
        invite.active &&
        (!invite.expiresAt || Date.parse(invite.expiresAt) > nowMs) &&
        invite.claimCount < invite.maxClaims;
      return (
        `${invite.label} ${invite.email ?? ""}`.toLowerCase().includes(query) &&
        (filter === "all" ||
          filter === invite.kind ||
          (filter === "available" && available) ||
          (filter === "unavailable" && !available))
      );
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <section className={styles.panel} aria-labelledby="invites-heading">
      <div className={styles.panelHeading}>
        <div>
          <h2 id="invites-heading">Undangan & akses baru</h2>
          <p>Izinkan email Google atau bagikan kode undangan.</p>
        </div>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={onCreate}
        >
          <Plus size={16} aria-hidden="true" /> Buat undangan
        </button>
      </div>
      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <Search size={17} aria-hidden="true" />
          <label htmlFor="invite-search" className="sr-only">
            Cari undangan pada halaman ini
          </label>
          <input
            id="invite-search"
            type="search"
            placeholder="Cari nama undangan atau email…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <label className={styles.selectLabel}>
          <span className="sr-only">Filter undangan</span>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">Semua undangan</option>
            <option value="available">Bisa diklaim</option>
            <option value="unavailable">Tidak tersedia</option>
            <option value="email">Email Google</option>
            <option value="code">Kode undangan</option>
          </select>
        </label>
      </div>
      <p className={styles.scopeNote} role="status">
        {filtered.length} dari {invites.length} undangan pada halaman ini.
        Diurutkan dari tanggal pembuatan terbaru di halaman ini.
      </p>
      {filtered.length ? (
        <div className={styles.inviteGrid}>
          {filtered.map((invite) => (
            <InviteCard
              key={`${invite.id}-${invite.updatedAt}`}
              invite={invite}
              nowMs={nowMs}
              onMessage={onMessage}
              onChanged={onChanged}
            />
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          <MailPlus size={30} aria-hidden="true" />
          <h3>
            {invites.length ? "Undangan tidak ditemukan" : "Belum ada undangan"}
          </h3>
          <p>
            {invites.length
              ? "Coba pencarian atau filter lain."
              : "Beri akses pertama lewat email Google atau kode."}
          </p>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onCreate}
          >
            Beri akses baru
          </button>
        </div>
      )}
    </section>
  );
}

export function InviteForm({
  onMessage: report,
  onBusyChange,
  onChanged,
  appOrigin,
}: {
  onMessage: (text: string, error?: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  onChanged: () => void;
  appOrigin: string;
}) {
  const [kind, setKind] = useState("code");
  const [pending, startTransition] = useTransition();
  const [secret, setSecret] = useState<string | null>(null);
  const [invitationMessage, setInvitationMessage] = useState<string | null>(
    null,
  );
  const [feedback, setFeedback] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  function onMessage(text: string, error = false) {
    setFeedback({ text, error });
    report(text, error);
  }
  return (
    <section className={styles.inviteForm}>
      <p className={styles.muted}>
        Undang lewat kode atau izinkan satu email Google. Akun yang sudah ada
        diatur di tab Pengguna.
      </p>
      {feedback && (
        <p
          role={feedback.error ? "alert" : "status"}
          className={feedback.error ? styles.errorNote : styles.inlineNote}
        >
          {feedback.text}
        </p>
      )}
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          setSecret(null);
          setInvitationMessage(null);
          onBusyChange(true);
          startTransition(async () => {
            try {
              const response = await createInviteAction({
                label: String(data.get("label") ?? ""),
                code:
                  kind === "code" ? String(data.get("code") ?? "") : undefined,
                email:
                  kind === "email"
                    ? String(data.get("email") ?? "")
                    : undefined,
                expiresAt: fromWitaInput(String(data.get("expiresAt") ?? "")),
                maxClaims: kind === "email" ? 1 : Number(data.get("maxClaims")),
                accessDays: data.get("accessDays")
                  ? Number(data.get("accessDays"))
                  : null,
              });
              if (!response.ok) {
                onMessage(response.error, true);
                return;
              }
              setSecret(response.data.code);
              if (response.data.code) {
                const deadline = fromWitaInput(
                  String(data.get("expiresAt") ?? ""),
                );
                const accessDays = String(data.get("accessDays") ?? "");
                setInvitationMessage(
                  [
                    "Hai! Kamu diundang menggunakan Patungin untuk membagi tagihan bersama.",
                    `Buka: ${appOrigin.replace(/\/$/, "")}`,
                    "1. Masuk dengan akun Google.",
                    `2. Di halaman aktivasi, masukkan kode: ${response.data.code}`,
                    "3. Setelah aktif, kamu bisa mulai membuat tagihan.",
                    deadline
                      ? `Klaim kode sebelum ${dateLabel(deadline)}.`
                      : null,
                    accessDays
                      ? `Masa akses: ${accessDays} hari setelah aktivasi.`
                      : null,
                  ]
                    .filter(Boolean)
                    .join("\n"),
                );
              }
              onMessage(
                kind === "email"
                  ? "Email diizinkan. Pengguna dapat masuk dengan Google."
                  : "Undangan dibuat. Salin kode sebelum meninggalkan halaman.",
              );
              form.reset();
              onChanged();
            } catch {
              onMessage("Periksa koneksi dan coba lagi.", true);
            } finally {
              onBusyChange(false);
            }
          });
        }}
      >
        <fieldset disabled={pending} className={styles.fieldset}>
          <label>
            Cara mengundang
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="code">Kode undangan</option>
              <option value="email">Email Google langsung</option>
            </select>
          </label>
          <label>
            Nama undangan
            <input
              name="label"
              maxLength={80}
              placeholder="Misalnya: Teman kantor"
            />
          </label>
          {kind === "code" ? (
            <>
              <label>
                Kode pilihanmu
                <input
                  name="code"
                  minLength={8}
                  maxLength={24}
                  pattern={"[A-Za-z0-9\\-]{8,24}"}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="MAKANBARENG"
                />
                <small>
                  8–24 huruf/angka/tanda hubung. Kosongkan untuk kode acak.
                </small>
              </label>
              <label>
                Maksimal akun
                <input
                  required
                  name="maxClaims"
                  type="number"
                  defaultValue={1}
                  min={1}
                  max={10000}
                />
              </label>
            </>
          ) : (
            <label>
              Email Google
              <input
                required
                type="email"
                name="email"
                autoComplete="email"
                maxLength={254}
                placeholder="nama@gmail.com"
              />
            </label>
          )}
          <label>
            Batas waktu klaim (WITA)
            <input type="datetime-local" name="expiresAt" />
            <small>Kosong berarti undangan tidak dibatasi tanggal.</small>
          </label>
          <label>
            Masa akses setelah aktivasi (hari)
            <input
              type="number"
              name="accessDays"
              min={1}
              max={3650}
              placeholder="Tanpa batas"
            />
            <small>
              Berbeda dari batas waktu klaim. Bisa diatur lagi per akun.
            </small>
          </label>
          <button className={ui.primary} disabled={pending}>
            <Plus size={17} aria-hidden="true" />
            {pending
              ? "Membuat…"
              : kind === "code"
                ? "Buat undangan"
                : "Izinkan email"}
          </button>
        </fieldset>
      </form>
      {secret && (
        <div className={styles.secret} role="status">
          <strong>Kode hanya ditampilkan sekarang</strong>
          <code>{secret}</code>
          <button
            className={ui.secondary}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(secret);
                onMessage("Kode tersalin.");
              } catch {
                onMessage(
                  "Belum bisa menyalin. Pilih dan salin kode secara manual.",
                  true,
                );
              }
            }}
          >
            <Copy size={16} aria-hidden="true" />
            Salin kode
          </button>
          {invitationMessage && (
            <>
              <label className={styles.messagePreview}>
                Pesan siap dibagikan
                <textarea readOnly rows={8} value={invitationMessage} />
              </label>
              <button
                type="button"
                className={ui.primary}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(invitationMessage);
                    onMessage(
                      "Pesan undangan tersalin. Tempel di WhatsApp untuk mengirim.",
                    );
                  } catch {
                    onMessage(
                      "Belum bisa menyalin. Pilih teks pesan untuk menyalin manual.",
                      true,
                    );
                  }
                }}
              >
                <Copy size={16} aria-hidden="true" /> Salin pesan WhatsApp
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function InviteCard({
  invite,
  onMessage,
  nowMs,
  onChanged,
}: {
  nowMs: number;
  invite: InviteRecord;
  onMessage: (text: string, error?: boolean) => void;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const expired = !!invite.expiresAt && Date.parse(invite.expiresAt) <= nowMs;
  const full = invite.claimCount >= invite.maxClaims;
  return (
    <article className={styles.card}>
      <div className={styles.row}>
        <h3>{invite.label}</h3>
        <span
          className={`${styles.status} ${invite.active && !expired && !full ? styles.active : styles.inactive}`}
        >
          {!invite.active
            ? "Nonaktif"
            : expired
              ? "Kedaluwarsa"
              : full
                ? "Penuh"
                : "Aktif"}
        </span>
      </div>
      <p>{invite.kind === "email" ? invite.email : "Kode undangan"}</p>
      <div className={styles.row}>
        <strong>
          {invite.claimCount} / {invite.maxClaims} akun
        </strong>
        <span className={styles.muted}>
          Masa akses:{" "}
          {invite.accessDays === null
            ? "tanpa batas"
            : `${invite.accessDays} hari`}
        </span>
      </div>
      <p className={styles.muted}>Batas klaim: {dateLabel(invite.expiresAt)}</p>
      <dl className={styles.inviteDates}>
        <div>
          <dt>Dibuat</dt>
          <dd>{dateLabel(invite.createdAt)}</dd>
        </div>
        <div>
          <dt>Diubah</dt>
          <dd>{dateLabel(invite.updatedAt)}</dd>
        </div>
      </dl>
      <button
        type="button"
        className={ui.secondary}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            try {
              const result = await setInviteActiveAction(
                invite.id,
                !invite.active,
              );
              if (!result.ok) {
                onMessage(result.error, true);
                return;
              }
              onMessage(
                invite.active
                  ? "Undangan dinonaktifkan. Akun yang sudah aktif tetap memiliki akses."
                  : "Undangan diaktifkan. Batas klaim dan tanggal tetap berlaku.",
              );
              onChanged();
            } catch {
              onMessage("Belum berhasil. Coba lagi.", true);
            }
          })
        }
      >
        {pending
          ? "Menyimpan…"
          : invite.active
            ? "Nonaktifkan undangan"
            : "Aktifkan undangan"}
      </button>
    </article>
  );
}
