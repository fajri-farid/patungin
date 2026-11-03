import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { AppHeader } from "@/components/product/AppHeader";
import ui from "@/components/product/product.module.css";

export default function BillNotFound() {
  return (
    <div className={ui.page}>
      <AppHeader />
      <main className={ui.main}>
        <section className={`${ui.panel} ${ui.empty}`}>
          <ReceiptText size={34} aria-hidden="true" />
          <h1 className={ui.sectionTitle}>Tagihan tidak ditemukan.</h1>
          <p>
            Tagihan ini mungkin sudah dihapus. Buka daftar untuk melihat
            tagihanmu yang lain.
          </p>
          <Link href="/app" className={ui.primary}>
            Ke tagihan saya
          </Link>
        </section>
      </main>
    </div>
  );
}
