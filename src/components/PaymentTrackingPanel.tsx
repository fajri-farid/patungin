"use client";

import { useEffect, useId, useRef } from "react";
import { AlertCircle, Check, CheckCircle2, RefreshCw, Wallet, Clock3 } from "lucide-react";
import {
  trackingLabel,
  type TrackingView,
  type PaymentObligation,
} from "@/domain/billing/tracking";
import { formatRupiah } from "@/domain/billing/money";
import ui from "@/components/product/product.module.css";
import styles from "./payment-tracking.module.css";

type Person = PaymentObligation & { name: string };
function timestamp(value: string) {
  return new Date(value).toLocaleString("id-ID", {
    timeZone: "Asia/Singapore",
    dateStyle: "medium",
    timeStyle: "short",
  });
}
function shortTimestamp(value: string) {
  return new Date(value).toLocaleString("id-ID", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PaymentTrackingPanel({
  view,
  people,
  busy = false,
  onChange,
  onRefresh,
  error,
}: {
  view: TrackingView;
  people: Person[];
  busy?: boolean;
  onChange?: (participantId?: string, status?: "paid" | "unpaid") => void;
  onRefresh?: () => void;
  error?: { message: string; participantId?: string; action?: () => void; actionLabel?: string } | null;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const feedbackId = useId();
  const previousState = useRef(view.state);
  useEffect(() => {
    if (
      onChange &&
      previousState.current === "inactive" &&
      view.state === "active"
    )
      heading.current?.focus();
    previousState.current = view.state;
  }, [view.state, onChange]);
  const eligible = people.filter((person) =>
    Object.hasOwn(view.entries, person.id),
  );
  const exempt = people.filter(
    (person) => person.isPayer || person.transferToPayerAmount === 0,
  );
  const complete =
    view.state === "active" && view.count > 0 && view.paidCount === view.count;
  const progress = view.count
    ? Math.round((view.paidCount / view.count) * 100)
    : 0;
  const feedback = error && (
    <div id={feedbackId} role="alert" className={`${styles.feedback} ${error.participantId ? styles.rowFeedback : ""}`}>
      <span className={styles.feedbackIcon} aria-hidden="true"><AlertCircle size={18} /></span>
      <p className={styles.feedbackMessage}>{error.message}</p>
      {(error.action || (!onChange && onRefresh)) && (
        <button type="button" disabled={busy} onClick={error.action ?? onRefresh} className={styles.feedbackAction}>
          <RefreshCw size={15} aria-hidden="true" />
          {error.actionLabel ?? "Coba muat ulang"}
        </button>
      )}
    </div>
  );

  return (
    <section
      className={`${ui.panel} ${styles.panel}`}
      aria-label="Pembayaran"
      aria-busy={busy}
    >
      <div className={styles.header}>
        <div className={styles.headingGroup}>
          <span className={styles.headingIcon} aria-hidden="true">
            <Wallet size={19} />
          </span>
          <h2 ref={heading} tabIndex={-1} className={ui.sectionTitle}>
            Pembayaran
          </h2>
        </div>
        <button
          type="button"
          className={styles.refresh}
          disabled={busy}
          onClick={onRefresh ?? (() => window.location.reload())}
          aria-label="Muat ulang status"
          title="Muat ulang status"
        >
          <RefreshCw size={17} aria-hidden="true" />
          <span>Muat ulang</span>
        </button>
      </div>
      {error && !error.participantId && feedback}
      {view.state === "active" && view.count > 0 ? (
        <>
          <div
            className={`${styles.summary} ${complete ? styles.summaryComplete : ""}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <div className={styles.summaryNumbers}>
              <div>
                <span className={styles.metricLabel}>Uang diterima</span>
                <strong className={styles.received}>
                  {formatRupiah(view.received)}
                </strong>
              </div>
              <div className={styles.remaining}>
                <span className={styles.metricLabel}>Belum dibayar</span>
                <strong>{formatRupiah(view.remaining)}</strong>
              </div>
            </div>
            <div className={styles.progressTrack} aria-hidden="true">
              <span style={{ width: `${progress}%` }} />
            </div>
            <p className={styles.progressCaption}>
              {complete ? (
                <>
                  <CheckCircle2 size={15} aria-hidden="true" /> Semua sudah
                  bayar
                </>
              ) : (
                <>
                  <span>
                    {view.paidCount} dari {view.count} orang sudah bayar
                  </span>
                  <span>{progress}%</span>
                </>
              )}
            </p>
            {busy && <p className={styles.saving}>Menyimpan…</p>}
          </div>
          <p className={styles.instruction}>
            {onChange
              ? "Centang namanya setelah uang diterima."
              : "Siapa pun yang punya link bisa melihat daftar ini."}
          </p>
          <ul
            className={styles.list}
            aria-label={
              onChange
                ? "Tandai siapa yang sudah bayar"
                : "Status pembayaran teman"
            }
          >
            {eligible.map((person) => {
              const entry = view.entries[person.id];
              const paid = entry.status === "paid";
              const content = (
                <>
                  <span className={styles.person}>
                    <strong>{person.name}</strong>
                    <span
                      className={paid ? styles.paidText : styles.unpaidText}
                    >
                      {paid ? "Lunas" : "Belum bayar"}
                      {entry.paidAt && (
                        <>
                          <span aria-hidden="true"> · </span>
                          <time
                            dateTime={entry.paidAt}
                            title={timestamp(entry.paidAt)}
                          >
                            {shortTimestamp(entry.paidAt)}
                          </time>
                        </>
                      )}
                    </span>
                  </span>
                  <span className={styles.amount}>
                    {formatRupiah(person.transferToPayerAmount)}
                  </span>
                </>
              );
              return (
                <li key={person.id} className={paid ? styles.paidRow : ""}>
                  {onChange ? (
                    <label
                      className={`${styles.row} ${styles.editable} ${busy ? styles.disabled : ""}`}
                    >
                      <input
                        className={styles.checkbox}
                        type="checkbox"
                        checked={paid}
                        disabled={busy}
                        aria-label={`Lunas: ${person.name}`}
                        aria-describedby={error?.participantId === person.id ? feedbackId : undefined}
                        onChange={(event) => {
                          const nextPaid = event.currentTarget.checked;
                          if (
                            !nextPaid &&
                            !window.confirm(
                              `Tandai ${person.name} sebagai belum bayar?`,
                            )
                          )
                            return;
                          onChange(person.id, nextPaid ? "paid" : "unpaid");
                        }}
                      />
                      {content}
                    </label>
                  ) : (
                    <div className={styles.row}>
                      <span
                        className={`${styles.readonlyIcon} ${paid ? styles.paidText : ""}`}
                        aria-hidden="true"
                      >
                        {paid ? (
                          <CheckCircle2 size={21} />
                        ) : (
                          <Clock3 size={21} />
                        )}
                      </span>
                      {content}
                    </div>
                  )}
                  {error?.participantId === person.id && feedback}
                </li>
              );
            })}
          </ul>
          {!!exempt.length && (
            <ul className={styles.exemptList} aria-label="Tidak perlu membayar">
              {exempt.map((person) => (
                <li key={person.id}>
                  <span className={styles.exemptName}>{person.name}</span>
                  <span>
                    {person.isPayer
                      ? "Sudah bayar duluan"
                      : "Tidak perlu bayar"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.footer}>
            <p>{onChange ? "Siapa pun yang punya link bisa melihat daftar ini." : "Status ditandai oleh pembuat tagihan."}</p>
            {view.updatedAt && (
              <p>
                <time dateTime={view.updatedAt}>
                  Terakhir diubah {shortTimestamp(view.updatedAt)}
                </time>
              </p>
            )}
          </div>
        </>
      ) : (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <Check size={22} />
          </span>
          <p className={styles.emptyTitle} role="status">
            {trackingLabel(view)}
          </p>
          {view.state === "inactive" && view.count > 0 && (
            <>
              <p>
                {onChange
                  ? "Centang teman yang sudah membayar agar mudah mengecek sisanya."
                  : "Pembuat tagihan belum menandai siapa yang sudah bayar."}
              </p>
              {onChange && (
                <>
                  <button
                    type="button"
                    className={ui.primary}
                    disabled={busy}
                    onClick={() => onChange()}
                    aria-describedby={error && !error.participantId ? feedbackId : undefined}
                  >
                    {busy ? "Menyiapkan…" : "Mulai tandai pembayaran"}
                  </button>
                  <p className={styles.disclosure}>
                    Siapa pun yang punya link bisa melihat daftar ini.
                  </p>
                </>
              )}
            </>
          )}
          {view.state === "unavailable" && (
            <p>
              Tekan Muat ulang untuk mencoba lagi.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
