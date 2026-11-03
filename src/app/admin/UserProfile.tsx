"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  loadUserProfile,
  loadUserActivity,
  loadAccountAudits,
} from "@/app/actions/admin";
import { AdminDialog } from "./AdminDialog";
import { AdminPager } from "./AdminPager";
import { UserEditor, StatusBadge } from "./UserManagement";
import {
  dateLabel,
  durationLabel,
  scanState,
  type MessageHandler,
} from "./admin-utils";
import type { getUserProfile, getAccountAudits } from "@/server/admin/data";
import type { ActivityPage } from "@/server/admin/monitoring";
import type { MonitorPeriod } from "@/server/admin/pagination";
import type { AccountSettings } from "@/server/admin/summary";
import styles from "./admin.module.css";
import { ScanExplanation } from "./ScanExplanation";

type Profile = Awaited<ReturnType<typeof getUserProfile>>;
type Audits = Awaited<ReturnType<typeof getAccountAudits>>;
type DetailTab = "summary" | "activity" | "changes";
const TABS: Array<{ id: DetailTab; label: string }> = [
  { id: "summary", label: "Ringkasan" },
  { id: "activity", label: "Aktivitas" },
  { id: "changes", label: "Perubahan" },
];
const FIELDS: Array<{ key: keyof AccountSettings; label: string }> = [
  { key: "status", label: "Status" },
  { key: "accessUntil", label: "Akses sampai" },
  { key: "monthlyLimit", label: "Jatah bulanan" },
  { key: "bonus", label: "Bonus bulan tersebut" },
];
function settingLabel(
  key: keyof AccountSettings,
  value: AccountSettings[keyof AccountSettings],
) {
  if (key === "accessUntil") return dateLabel(value as string | null);
  if (key === "status")
    return value === "active"
      ? "Aktif"
      : value === "disabled"
        ? "Nonaktif"
        : "Menunggu akses";
  return `${value} scan`;
}

export function UserProfile({
  uid,
  onClose,
  onMessage,
  onSaved,
}: {
  uid: string;
  onClose: () => void;
  onMessage: MessageHandler;
  onSaved: () => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<DetailTab>("summary");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [period, setPeriod] = useState<MonitorPeriod>("month");
  const [activity, setActivity] = useState<ActivityPage | null>(null);
  const [audits, setAudits] = useState<Audits | null>(null);
  const [after, setAfter] = useState<string | undefined>();
  const cache = useRef(new Map<string, ActivityPage | Audits>());
  const history = useRef<Array<string | undefined>>([]);
  const [hasPrevious, setHasPrevious] = useState(false);
  const initialRequest = useRef<ReturnType<typeof loadUserProfile> | null>(
    null,
  );
  useEffect(() => {
    let active = true;
    initialRequest.current ??= loadUserProfile(uid);
    initialRequest.current
      .then((result) => {
        if (!active) return;
        if (result.ok) setProfile(result.data);
        else setError(result.error);
      })
      .catch(() => {
        if (active)
          setError("Profil belum dapat dimuat. Tutup panel lalu coba lagi.");
      });
    return () => {
      active = false;
    };
  }, [uid]);
  function loadDetail(
    target: Exclude<DetailTab, "summary">,
    targetPeriod = period,
    cursor?: string,
    remember = false,
  ) {
    const key = JSON.stringify([target, targetPeriod, cursor ?? ""]);
    const apply = (value: ActivityPage | Audits) => {
      if (remember) history.current.push(after);
      setHasPrevious(history.current.length > 0);
      setAfter(cursor);
      setTab(target);
      setPeriod(targetPeriod);
      if (target === "activity") setActivity(value as ActivityPage);
      else setAudits(value as Audits);
    };
    const saved = cache.current.get(key);
    if (saved) {
      apply(saved);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result =
          target === "activity"
            ? await loadUserActivity(uid, targetPeriod, cursor)
            : await loadAccountAudits(uid, cursor);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (cache.current.size >= 8)
          cache.current.delete(cache.current.keys().next().value!);
        cache.current.set(key, result.data);
        apply(result.data);
      } catch {
        setError("Detail belum dapat dimuat. Coba lagi.");
      }
    });
  }
  function selectTab(value: DetailTab) {
    if (value === tab) return;
    history.current = [];
    setHasPrevious(false);
    setAfter(undefined);
    if (value === "summary") setTab(value);
    else loadDetail(value);
  }
  const detail = tab === "activity" ? activity : audits;
  return (
    <AdminDialog
      title={profile?.user.displayName ?? "Memuat profil…"}
      description={profile?.user.email}
      onClose={onClose}
      busy={saving}
    >
      {error && (
        <p role="alert" className={styles.errorNote}>
          {error}
        </p>
      )}
      {!profile && !error && (
        <p role="status">Mengambil status akses dan kuota terbaru…</p>
      )}
      {profile && (
        <>
          <div
            role="tablist"
            aria-label="Detail pengguna"
            className={styles.profileTabs}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                  event.key,
                ) ||
                pending ||
                saving
              )
                return;
              event.preventDefault();
              const current = TABS.findIndex((t) => t.id === tab);
              const index =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? 2
                    : (current + (event.key === "ArrowRight" ? 1 : -1) + 3) % 3;
              selectTab(TABS[index].id);
              document.getElementById(`profile-${TABS[index].id}`)?.focus();
            }}
          >
            {TABS.map(({ id, label }) => (
              <button
                type="button"
                role="tab"
                id={`profile-${id}`}
                key={id}
                aria-controls={`profile-panel-${id}`}
                aria-selected={tab === id}
                tabIndex={tab === id ? 0 : -1}
                aria-disabled={pending || saving}
                onClick={() => {
                  if (!pending && !saving) selectTab(id);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {pending && (
            <p role="status" className={styles.scopeNote}>
              Memuat detail…
            </p>
          )}
          <div
            role="tabpanel"
            id="profile-panel-summary"
            aria-labelledby="profile-summary"
            hidden={tab !== "summary"}
          >
            <UserEditor
              embedded
              user={profile.user}
              quota={profile.quota}
              nowMs={profile.evaluatedAt}
              onClose={onClose}
              onMessage={onMessage}
              onChanged={onSaved}
              onBusyChange={setSaving}
            />
          </div>
          <div
            role="tabpanel"
            id="profile-panel-activity"
            aria-labelledby="profile-activity"
            hidden={tab !== "activity"}
            aria-busy={pending}
          >
            <label className={styles.periodControl}>
              Periode aktivitas
              <select
                value={period}
                disabled={pending}
                onChange={(event) => {
                  history.current = [];
                  loadDetail("activity", event.target.value as MonitorPeriod);
                }}
              >
                <option value="today">Hari ini</option>
                <option value="week">7 hari terakhir</option>
                <option value="month">Bulan ini</option>
              </select>
            </label>
            <p className={styles.scopeNote}>
              Aktivitas akun ini, dari yang terbaru. Catatan scan disimpan
              sekitar 30 hari.
            </p>
            {activity?.activity.map((scan) => (
              <article key={scan.id} className={styles.profileActivity}>
                <div className={styles.row}>
                  <time>{dateLabel(scan.reservedAt)}</time>
                  <StatusBadge state={scanState(scan, activity.evaluatedAt)} />
                </div>
                <p>
                  {scan.model} · {durationLabel(scan)}
                </p>
                <small>Tagihan: {scan.billId}</small>
                <ScanExplanation scan={scan} now={activity.evaluatedAt} />
              </article>
            ))}
            {activity && !activity.activity.length && (
              <p className={styles.inlineNote}>
                Tidak ada aktivitas pada periode ini dalam data yang masih
                tersimpan.
              </p>
            )}
          </div>
          <div
            role="tabpanel"
            id="profile-panel-changes"
            aria-labelledby="profile-changes"
            hidden={tab !== "changes"}
            aria-busy={pending}
          >
            <p className={styles.scopeNote}>
              Perubahan akses dan kuota oleh admin dicatat sejak fitur ini
              diterapkan, dan disimpan hingga 1 tahun.
            </p>
            {audits?.records.map((audit) => (
              <article className={styles.auditEntry} key={audit.id}>
                <time>{dateLabel(audit.createdAt)}</time>
                <p>Oleh {audit.actorEmail}</p>
                <small>Bonus berlaku untuk {audit.monthKey}</small>
                <dl>
                  {FIELDS.filter(
                    ({ key }) => audit.before[key] !== audit.after[key],
                  ).map(({ key, label }) => (
                    <div key={key}>
                      <dt>{label}</dt>
                      <dd>
                        <span>{settingLabel(key, audit.before[key])}</span>
                        <span aria-hidden="true"> → </span>
                        <strong>{settingLabel(key, audit.after[key])}</strong>
                      </dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
            {audits && !audits.records.length && (
              <p className={styles.inlineNote}>
                Belum ada perubahan admin yang tercatat untuk akun ini.
              </p>
            )}
          </div>
          {tab !== "summary" && (
            <AdminPager
              next={detail?.next ?? null}
              hasPrevious={hasPrevious}
              busy={pending}
              onNext={() => loadDetail(tab, period, detail!.next!, true)}
              onPrevious={() => {
                const previous = history.current.pop();
                loadDetail(tab, period, previous);
              }}
            />
          )}
        </>
      )}
    </AdminDialog>
  );
}
