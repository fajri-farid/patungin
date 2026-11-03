"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  Bell,
  MailPlus,
  Plus,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { loadAdminAlertCounts, loadAdminPanel } from "@/app/actions/admin";
import type { AdminTab, PanelData, PanelQuery } from "@/server/admin/data";
import { AdminDialog } from "./AdminDialog";
import { AdminMonitoring } from "./AdminMonitoring";
import { InviteForm, InvitesPanel } from "./AdminInvites";
import { UserManagement } from "./UserManagement";
import { UserProfile } from "./UserProfile";
import { AdminAlerts } from "./AdminAlerts";
import { AdminPager } from "./AdminPager";
import { dateLabel, monthLabel } from "./admin-utils";
import ui from "@/components/product/product.module.css";
import styles from "./admin.module.css";

const TABS = [
  { id: "monitor", label: "Monitoring", Icon: Activity },
  { id: "users", label: "Pengguna", Icon: Users },
  { id: "invites", label: "Undangan", Icon: MailPlus },
  { id: "alerts", label: "Peringatan", Icon: Bell },
] as const;
type AlertCounts = Awaited<ReturnType<typeof loadAdminAlertCounts>>;
let alertCache: { email: string; at: number; data: AlertCounts } | undefined;
let alertRequest: Promise<AlertCounts> | undefined;
const ROUTES: Record<AdminTab, string> = {
  monitor: "/admin/monitoring", users: "/admin/users",
  invites: "/admin/invites", alerts: "/admin/alerts",
};
const cacheKey = (query: PanelQuery) =>
  JSON.stringify([
    query.tab,
    query.after ?? "",
    query.field ?? "email",
    query.query ?? "",
    query.period ?? "month",
    query.alert ?? "low",
  ]);

export function AdminClient({
  email,
  initial,
  initialQuery,
  appOrigin,
}: {
  email: string;
  initial: PanelData;
  initialQuery: PanelQuery;
  appOrigin: string;
}) {
  const router = useRouter();
  const [counts, setCounts] = useState<AlertCounts | null>(null);
  const [countsVersion, setCountsVersion] = useState(0);
  useEffect(() => {
    let active = true;
    if (alertCache?.email === email && Date.now() - alertCache.at < 60000) {
      const saved = alertCache.data;
      queueMicrotask(() => { if (active) setCounts(saved); });
    } else {
      const request = alertRequest ?? loadAdminAlertCounts();
      alertRequest = request;
      request.then((data) => {
        if (alertRequest === request) {
          alertCache = { email, at: Date.now(), data };
          alertRequest = undefined;
        }
        if (active) setCounts(data);
      }).catch(() => { if (alertRequest === request) alertRequest = undefined; });
    }
    return () => { active = false; };
  }, [email, countsVersion]);
  function refreshCounts() {
    alertCache = undefined;
    alertRequest = undefined;
    setCounts(null);
    setCountsVersion((value) => value + 1);
  }
  const [panel, setPanel] = useState(initial);
  const [query, setQuery] = useState(initialQuery);
  const [pending, startTransition] = useTransition();
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  const cache = useRef(
    new Map([
      [
        cacheKey(initialQuery),
        { panel: initial, at: initial.data.evaluatedAt },
      ],
    ]),
  );
  const history = useRef<PanelQuery[]>([]);
  const [hasPrevious, setHasPrevious] = useState(false);
  const lastQueries = useRef<Partial<Record<AdminTab, PanelQuery>>>({
    [initialQuery.tab]: initialQuery,
  });
  const request = useRef(0);
  const inFlight = useRef(new Map<string, ReturnType<typeof loadAdminPanel>>());
  const queryRef = useRef(initialQuery);
  const tab = panel.tab;
  function onMessage(text: string, error = false) {
    setMessage({ text, error });
  }
  function load(target: PanelQuery, force = false, remember = false) {
    const serial = ++request.current;
    const key = cacheKey(target);
    const saved = cache.current.get(key);
    const apply = (next: PanelData) => {
      if (serial !== request.current) return;
      if (remember) history.current.push(queryRef.current);
      setHasPrevious(history.current.length > 0);
      queryRef.current = target;
      setPanel(next);
      setQuery(target);
      lastQueries.current[target.tab] = target;
    };
    startTransition(async () => {
      if (!force && saved && Date.now() - saved.at < 60000) {
        apply(saved.panel);
        return;
      }
      const existing = force ? undefined : inFlight.current.get(key);
      const operation = existing ?? loadAdminPanel(target);
      if (!existing) inFlight.current.set(key, operation);
      try {
        const result = await operation;
        if (serial !== request.current) return;
        if (!result.ok) {
          onMessage(result.error, true);
          return;
        }
        if (cache.current.size >= 12)
          cache.current.delete(cache.current.keys().next().value!);
        cache.current.set(key, { panel: result.data, at: Date.now() });
        apply(result.data);
      } catch {
        if (serial === request.current)
          onMessage("Data belum dapat dimuat. Coba perbarui lagi.", true);
      } finally {
        if (inFlight.current.get(key) === operation)
          inFlight.current.delete(key);
      }
    });
  }
  function switchTab(next: AdminTab) {
    router.push(ROUTES[next]);
  }
  function invalidate(scope: "all" | "invites" = "all") {
    if (scope === "all") { cache.current.clear(); refreshCounts(); }
    else
      for (const [key, value] of cache.current)
        if (value.panel.tab === scope) cache.current.delete(key);
    if (scope === "all" || queryRef.current.tab === scope)
      load(queryRef.current, true);
  }
  const next = panel.data.next;
  const now = panel.data.evaluatedAt;
  const month = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Makassar",
    year: "numeric",
    month: "2-digit",
  }).format(new Date(now));
  return (
    <div className={ui.page}>
      <header className={styles.adminHeader}>
        <div className={styles.adminHeaderInner}>
          <Link
            href="/app"
            className={styles.adminBrand}
            aria-label="Patungin, tagihan saya"
          >
            <span>
              <ReceiptText size={20} aria-hidden="true" />
            </span>
            <strong translate="no">Patungin</strong>
            <small>Admin</small>
          </Link>
          <div className={styles.headerAccount}>
            <span className={styles.signedIn}>
              <ShieldCheck size={15} aria-hidden="true" />
              {email}
            </span>
            <Link
              href="/app"
              className={styles.backLink}
              aria-label="Kembali ke tagihan saya"
            >
              <ArrowLeft size={15} aria-hidden="true" />
              <span>Tagihan saya</span>
            </Link>
          </div>
        </div>
      </header>
      <main className={styles.shell}>
        <div className={styles.intro}>
          <div>
            <p className={styles.eyebrow}>
              RUANG ADMIN <span aria-hidden="true">/</span> {monthLabel(month)}
            </p>
            <h1>Pemakaian jelas. Akses terkelola.</h1>
            <p>
              Pantau aktivitas scan, kelola pengguna, dan tambahkan bonus saat
              dibutuhkan.
            </p>
          </div>
          <div className={styles.introActions}>
            <Link
              href="/admin/logs"
              prefetch={false}
              className={styles.secondaryButton}
            >
              Log aktivitas
            </Link>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={pending}
              onClick={() => {
                cache.current.clear();
                refreshCounts();
                load(query, true);
              }}
            >
              <RefreshCw
                size={16}
                aria-hidden="true"
                className={pending ? styles.spinning : ""}
              />
              {pending ? "Memuat…" : "Perbarui data"}
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => setCreatingInvite(true)}
            >
              <Plus size={17} aria-hidden="true" /> Beri akses baru
            </button>
          </div>
        </div>
        <div className={styles.pageMeta}>
          <span>
            <span className={styles.updateDot} aria-hidden="true" />
            Diperbarui {dateLabel(new Date(now).toISOString())}
          </span>
          <span>Reset kuota setiap tanggal 1, pukul 00.00 WITA</span>
        </div>
        {message && (
          <div className={styles.feedback} data-error={message.error}>
            <p role={message.error ? "alert" : "status"}>{message.text}</p>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => setMessage(null)}
              aria-label="Tutup pemberitahuan"
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>
        )}
        <nav aria-label="Pengelolaan admin" className={styles.tabs}>
          {TABS.map(({ id, label, Icon }) => {
            const available = counts && Object.values(counts).filter((item) => item.ok);
            const total = available ? available.reduce((sum, item) => sum + (item.ok ? item.data.count : 0), 0) : 0;
            const partial = !!counts && (available!.length < 3 || available!.some((item) => item.ok && item.data.more));
            return (
              <Link key={id} href={ROUTES[id]} prefetch={false} aria-current={tab === id ? "page" : undefined}>
                <Icon size={17} aria-hidden="true" />
                {label}
                {id === "alerts" && total > 0 && (
                  <span className={styles.alertPill} aria-label={`${partial ? "Setidaknya " : ""}${total} peringatan`}>
                    {partial ? `${total}+` : total}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className={styles.tabPanel} aria-busy={pending}>
          {panel.tab === "monitor" ? (
            <AdminMonitoring
              key={cacheKey(query)}
              data={panel.data}
              onManageUsers={() => switchTab("users")}
              onSelectUser={setSelectedUid}
              onPeriod={(period) => {
                history.current = [];
                load({ tab: "monitor", period });
              }}
            />
          ) : panel.tab === "users" ? (
            <UserManagement
              key={cacheKey(query)}
              users={panel.data.users}
              quotas={panel.data.quotas}
              nowMs={now}
              onSelect={setSelectedUid}
              searchField={query.field ?? "email"}
              searchQuery={query.query ?? ""}
              onPrepared={() => invalidate()}
              onSearch={(field, text) => {
                history.current = [];
                load({ tab: "users", field, query: text });
              }}
            />
          ) : panel.tab === "invites" ? (
            <InvitesPanel
              key={cacheKey(query)}
              invites={panel.data.invites}
              nowMs={now}
              onMessage={onMessage}
              onCreate={() => setCreatingInvite(true)}
              onChanged={() => invalidate("invites")}
            />
          ) : (
            <AdminAlerts
              data={panel.data}
              counts={counts}
              kind={query.alert ?? "low"}
              onFilter={(alert) => {
                history.current = [];
                load({ tab: "alerts", alert });
              }}
              onSelect={setSelectedUid}
              onPrepared={() => invalidate()}
            />
          )}
          <AdminPager
            next={next}
            hasPrevious={hasPrevious}
            busy={pending}
            onNext={() => load({ ...query, after: next! }, false, true)}
            onPrevious={() => {
              const previous = history.current.pop();
              if (previous) load(previous);
            }}
          />
        </div>
        <footer className={styles.adminFooter}>
          <ShieldCheck size={14} aria-hidden="true" />
          <p>Ruang admin · Semua waktu ditampilkan dalam WITA.</p>
        </footer>
      </main>
      {selectedUid && (
        <UserProfile
          key={selectedUid}
          uid={selectedUid}
          onClose={() => setSelectedUid(null)}
          onMessage={onMessage}
          onSaved={() => invalidate()}
        />
      )}
      {creatingInvite && (
        <AdminDialog
          title="Beri akses baru"
          description="Pilih email Google atau buat kode untuk dibagikan."
          busy={creatingBusy}
          onClose={() => setCreatingInvite(false)}
        >
          <InviteForm
            appOrigin={appOrigin}
            onMessage={onMessage}
            onBusyChange={setCreatingBusy}
            onChanged={() => invalidate("invites")}
          />
        </AdminDialog>
      )}
    </div>
  );
}
