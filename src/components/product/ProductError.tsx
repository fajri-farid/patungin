"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { AppHeader } from "./AppHeader";
import ui from "./product.module.css";

export function ProductError({ retry }: { retry: () => void }) {
  return (
    <div className={ui.page}>
      <AppHeader />
      <main className={ui.main}>
        <section className={`${ui.panel} ${ui.empty}`} role="alert">
          <h1 className={ui.sectionTitle}>Tagihan belum bisa dibuka.</h1>
          <p>Periksa koneksi internet, lalu coba lagi.</p>
          <div className="flex flex-wrap gap-3 justify-center mt-5">
            <button type="button" className={ui.primary} onClick={retry}>
              <RefreshCw size={17} aria-hidden="true" />
              Coba lagi
            </button>
            <Link href="/app" className={ui.secondary}>
              Ke tagihan saya
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
