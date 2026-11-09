"use client";

import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { AppHeader } from "./AppHeader";
import ui from "./product.module.css";

export function ProductError({ retry }: { retry: () => void }) {
  return (
    <div className={ui.page}>
      <AppHeader />
      <main className={ui.main}>
        <section className={`${ui.panel} ${ui.empty}`} role="alert">
          <div
            className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-[#FFF3E6] text-[#9A4A12]"
            aria-hidden="true"
          >
            <AlertTriangle size={24} />
          </div>
          <h1 className={ui.sectionTitle}>Halaman belum bisa dibuka.</h1>
          <p>Periksa koneksi internetmu, lalu muat ulang halaman ini.</p>
          <div className="flex flex-wrap gap-2.5 justify-center mt-5">
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
