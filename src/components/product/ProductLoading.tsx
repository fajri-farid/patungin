import { Loader2 } from "lucide-react";
import { AppHeader } from "./AppHeader";
import ui from "./product.module.css";

export function ProductLoading() {
  return (
    <div className={ui.page}>
      <AppHeader />
      <main className={ui.main}>
        <div
          className={`${ui.panel} flex items-center justify-center gap-3 min-h-48`}
          role="status"
        >
          <Loader2 size={21} className={ui.spinner} aria-hidden="true" />
          <p className={ui.muted}>Membuka tagihan…</p>
        </div>
      </main>
    </div>
  );
}
