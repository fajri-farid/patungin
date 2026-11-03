import Link from "next/link";
import { History, LogOut, ReceiptText } from "lucide-react";
import ui from "./product.module.css";

export function AppHeader({
  email,
  onLogout,
  pending,
  history = false,
  admin = false,
  hideNavigation = false,
}: {
  email?: string;
  onLogout?: () => void;
  pending?: boolean;
  history?: boolean;
  admin?: boolean;
  hideNavigation?: boolean;
}) {
  return (
    <header className={ui.header}>
      <div className={ui.headerInner}>
        <Link
          href="/app"
          className={ui.brand}
          aria-label="Patungin, tagihan saya"
        >
          <span className={ui.brandIcon}>
            <ReceiptText size={19} aria-hidden="true" />
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
          {!hideNavigation && <nav className={ui.navigation} aria-label="Navigasi aplikasi">
            {admin && <Link href="/admin">Kelola</Link>}
            {history ? (
              <Link href="/app">Tagihan saya</Link>
            ) : (
              <Link href="/history">
                <History size={16} aria-hidden="true" />
                Riwayat
              </Link>
            )}
          </nav>}
          {onLogout && (
            <button
              type="button"
              className={ui.logout}
              onClick={onLogout}
              disabled={pending}
              aria-label="Keluar dari akun"
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
