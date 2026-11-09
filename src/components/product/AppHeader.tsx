import { GuardedLink as Link } from "../NavigationGuard";
import {
  History,
  Home,
  Landmark,
  LogOut,
  ReceiptText,
  Shield,
} from "lucide-react";
import ui from "./product.module.css";

export function AppHeader({
  email,
  onLogout,
  pending,
  history = false,
  admin = false,
  hideNavigation = false,
  activePage,
}: {
  email?: string;
  onLogout?: () => void;
  pending?: boolean;
  history?: boolean;
  admin?: boolean;
  hideNavigation?: boolean;
  activePage?: "app" | "history" | "settings";
}) {
  const current = activePage ?? (history ? "history" : undefined);

  return (
    <header className={ui.header}>
      <div className={ui.headerInner}>
        <Link
          href="/app"
          className={ui.brand}
          aria-label="Patungin, tagihan saya"
        >
          <span className={ui.brandIcon}>
            <ReceiptText size={18} aria-hidden="true" />
          </span>
          <span className={ui.brandText}>
            <strong translate="no">Patungin</strong>
            {email && (
              <span className={ui.accountEmail} title={email}>
                {email}
              </span>
            )}
          </span>
        </Link>
        <div className={ui.account}>
          {!hideNavigation && (
            <nav className={ui.navigation} aria-label="Navigasi aplikasi">
              {admin && (
                <Link href="/admin" aria-label="Kelola aplikasi" title="Kelola">
                  <Shield size={16} aria-hidden="true" />
                  <span className={ui.navLabelHideTiny}>Kelola</span>
                </Link>
              )}
              <Link
                href="/settings/payments"
                aria-current={current === "settings" ? "page" : undefined}
                aria-label="Pengaturan pembayaran"
                title="Pengaturan pembayaran"
              >
                <Landmark size={16} aria-hidden="true" />
                <span className={ui.navLabelHideTiny}>Pengaturan</span>
              </Link>
              {history || current === "history" || current === "settings" ? (
                <Link
                  href="/app"
                  aria-current={current === "app" ? "page" : undefined}
                  aria-label="Tagihan saya"
                  title="Tagihan saya"
                >
                  <Home size={16} aria-hidden="true" />
                  <span className={ui.navLabelHideTiny}>Tagihan</span>
                </Link>
              ) : (
                <Link
                  href="/history"
                  aria-label="Riwayat tagihan"
                  title="Riwayat tagihan"
                >
                  <History size={16} aria-hidden="true" />
                  <span className={ui.navLabelHideTiny}>Riwayat</span>
                </Link>
              )}
            </nav>
          )}
          {onLogout && (
            <button
              type="button"
              className={ui.logout}
              onClick={onLogout}
              disabled={pending}
              aria-label="Keluar dari akun"
              title="Keluar dari akun"
            >
              <LogOut size={16} aria-hidden="true" />
              <span>Keluar</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
