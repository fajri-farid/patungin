"use client";
import Link from "next/link";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <main className="max-w-lg mx-auto p-8 space-y-4">
      <h1 className="text-lg font-bold">Pengaturan belum bisa dimuat</h1>
      <p>Periksa koneksi dan akses akunmu, lalu coba lagi.</p>
      <button className="min-h-11 text-[#2855D9] font-bold" onClick={reset}>
        Coba lagi
      </button>
      <Link className="block" href="/app">
        Kembali ke tagihan
      </Link>
    </main>
  );
}
