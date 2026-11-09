import { Loader2 } from "lucide-react";
import { AppHeader } from "./AppHeader";
import ui from "./product.module.css";

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`${ui.skeleton} ${className}`} aria-hidden="true" />;
}

export function ReceiptImageSkeleton({
  label = "Mengunduh foto struk…",
}: {
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="relative flex min-h-[268px] w-full flex-col items-center justify-center overflow-hidden rounded-xl border border-[#D8E2F2] bg-[#F8FAFF] p-4"
    >
      {/* Simulated receipt paper sheet */}
      <div
        aria-hidden="true"
        className="w-full max-w-[260px] space-y-3 rounded-xl border border-[#E2EAF6] bg-white p-4 shadow-2xs"
      >
        <div className="flex flex-col items-center space-y-1.5 border-b border-dashed border-[#D8E2F2] pb-3">
          <SkeletonBlock className="h-3.5 w-28 rounded-md" />
          <SkeletonBlock className="h-2.5 w-20 rounded-md" />
        </div>
        <div className="space-y-2.5 py-1">
          <div className="flex items-center justify-between gap-3">
            <SkeletonBlock className="h-3 w-32 rounded-md" />
            <SkeletonBlock className="h-3 w-14 rounded-md" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <SkeletonBlock className="h-3 w-24 rounded-md" />
            <SkeletonBlock className="h-3 w-16 rounded-md" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <SkeletonBlock className="h-3 w-28 rounded-md" />
            <SkeletonBlock className="h-3 w-12 rounded-md" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <SkeletonBlock className="h-3 w-20 rounded-md" />
            <SkeletonBlock className="h-3 w-14 rounded-md" />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-dashed border-[#D8E2F2] pt-3">
          <SkeletonBlock className="h-3.5 w-16 rounded-md" />
          <SkeletonBlock className="h-4 w-20 rounded-md" />
        </div>
      </div>

      {/* Status pill */}
      <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-[#C9DAFC] bg-white px-3.5 py-1.5 text-xs font-bold text-[#2855D9] shadow-2xs">
        <Loader2 size={14} className={ui.spinner} aria-hidden="true" />
        <span>{label}</span>
      </div>
    </div>
  );
}

export function QrisImageSkeleton({
  label = "Memuat kode QRIS…",
}: {
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto flex w-full max-w-[280px] flex-col items-center justify-center rounded-2xl border border-[#D8E2F2] bg-white p-4 space-y-3"
    >
      <div
        aria-hidden="true"
        className="grid aspect-square w-full max-w-[210px] grid-cols-3 grid-rows-3 gap-2.5 rounded-xl border border-[#E2EAF6] bg-[#F8FAFF] p-3.5"
      >
        <div className="rounded-lg border-4 border-[#DCE7FA] p-1.5">
          <SkeletonBlock className="h-full w-full rounded-sm" />
        </div>
        <div className="space-y-1.5 py-1">
          <SkeletonBlock className="h-2.5 w-full rounded-sm" />
          <SkeletonBlock className="h-2.5 w-3/4 rounded-sm" />
          <SkeletonBlock className="h-2.5 w-5/6 rounded-sm" />
        </div>
        <div className="rounded-lg border-4 border-[#DCE7FA] p-1.5">
          <SkeletonBlock className="h-full w-full rounded-sm" />
        </div>

        <div className="space-y-1.5 py-1">
          <SkeletonBlock className="h-2.5 w-4/5 rounded-sm" />
          <SkeletonBlock className="h-2.5 w-full rounded-sm" />
          <SkeletonBlock className="h-2.5 w-2/3 rounded-sm" />
        </div>
        <div className="flex items-center justify-center rounded-lg bg-white border border-[#E2EAF6] p-2">
          <SkeletonBlock className="h-7 w-7 rounded-md" />
        </div>
        <div className="space-y-1.5 py-1">
          <SkeletonBlock className="h-2.5 w-full rounded-sm" />
          <SkeletonBlock className="h-2.5 w-3/5 rounded-sm" />
          <SkeletonBlock className="h-2.5 w-4/5 rounded-sm" />
        </div>

        <div className="rounded-lg border-4 border-[#DCE7FA] p-1.5">
          <SkeletonBlock className="h-full w-full rounded-sm" />
        </div>
        <div className="space-y-1.5 py-1">
          <SkeletonBlock className="h-2.5 w-3/4 rounded-sm" />
          <SkeletonBlock className="h-2.5 w-full rounded-sm" />
          <SkeletonBlock className="h-2.5 w-2/3 rounded-sm" />
        </div>
        <div className="grid grid-cols-2 gap-1.5 p-1">
          <SkeletonBlock className="h-full w-full rounded-sm" />
          <SkeletonBlock className="h-full w-full rounded-sm" />
          <SkeletonBlock className="h-full w-full rounded-sm" />
          <SkeletonBlock className="h-full w-full rounded-sm" />
        </div>
      </div>

      <div className="inline-flex items-center gap-2 rounded-full bg-[#E6EDFF] px-3 py-1 text-xs font-bold text-[#2855D9]">
        <Loader2 size={13} className={ui.spinner} aria-hidden="true" />
        <span>{label}</span>
      </div>
    </div>
  );
}

export function SavedMethodsInlineSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="space-y-2.5"
    >
      <span className="sr-only">Memuat daftar tujuan pembayaran tersimpan…</span>
      {[0, 1].map((item) => (
        <div
          key={item}
          aria-hidden="true"
          className="flex items-center gap-3 rounded-xl border border-[#D8E2F2] bg-white p-3"
        >
          <SkeletonBlock className="h-5 w-5 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <SkeletonBlock className="h-4 w-36 rounded-md" />
            <SkeletonBlock className="h-3 w-48 max-w-full rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

function BillRowSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className={ui.billList} aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className={ui.billRow}>
          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <SkeletonBlock className="h-4.5 w-40 max-w-[60%] rounded-md" />
              <SkeletonBlock className="h-4.5 w-20 rounded-md" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SkeletonBlock className="h-5 w-24 rounded-full" />
              <SkeletonBlock className="h-3.5 w-32 rounded-md" />
            </div>
          </div>
          <SkeletonBlock className="h-9 w-9 shrink-0 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

function UploadCardSkeleton() {
  return (
    <section className={`${ui.panel} space-y-4`} aria-hidden="true">
      <div className="space-y-2">
        <SkeletonBlock className="h-5 w-36 rounded-md" />
        <SkeletonBlock className="h-3.5 w-64 max-w-full rounded-md" />
      </div>
      <div className="rounded-2xl border border-[#D8E2F2] bg-[#F8FAFF] p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <SkeletonBlock className="h-5 w-32 rounded-md" />
          <SkeletonBlock className="h-5 w-16 rounded-full" />
        </div>
        <SkeletonBlock className="h-8 w-28 rounded-md" />
        <SkeletonBlock className="h-2 w-full rounded-full" />
        <div className="flex items-center justify-between gap-2">
          <SkeletonBlock className="h-3 w-36 rounded-md" />
          <SkeletonBlock className="h-3 w-24 rounded-md" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SkeletonBlock className="h-24 w-full rounded-2xl" />
        <SkeletonBlock className="h-24 w-full rounded-2xl" />
      </div>
      <div className="border-t border-[#D8E2F2] pt-4 space-y-2">
        <SkeletonBlock className="h-12 w-full rounded-xl" />
        <SkeletonBlock className="mx-auto h-3.5 w-48 rounded-md" />
      </div>
    </section>
  );
}

export function DashboardSkeleton() {
  return (
    <div className={ui.page}>
      <AppHeader activePage="app" />
      <main className={ui.main} aria-busy="true">
        <p role="status" className="sr-only">
          Memuat halaman utama…
        </p>
        <UploadCardSkeleton />
        <section className={ui.panel} aria-hidden="true">
          <div className={ui.listHeading}>
            <SkeletonBlock className="h-5 w-36 rounded-md" />
            <SkeletonBlock className="h-4 w-20 rounded-md" />
          </div>
          <BillRowSkeletonList count={3} />
        </section>
      </main>
    </div>
  );
}

export function NewBillSkeleton() {
  return (
    <div className={ui.page}>
      <AppHeader />
      <main className={ui.main} aria-busy="true">
        <p role="status" className="sr-only">
          Menyiapkan halaman tagihan baru…
        </p>
        <div className="space-y-2 px-0.5" aria-hidden="true">
          <SkeletonBlock className="h-7 w-48 rounded-md" />
          <SkeletonBlock className="h-4 w-64 max-w-full rounded-md" />
        </div>
        <UploadCardSkeleton />
      </main>
    </div>
  );
}

export function HistorySkeleton() {
  return (
    <div className={ui.page}>
      <AppHeader history activePage="history" />
      <main className={ui.main} aria-busy="true">
        <p role="status" className="sr-only">
          Memuat riwayat tagihan…
        </p>
        <div className="space-y-2 px-0.5" aria-hidden="true">
          <SkeletonBlock className="h-7 w-44 rounded-md" />
          <SkeletonBlock className="h-4 w-72 max-w-full rounded-md" />
        </div>
        <section className={ui.panel} aria-hidden="true">
          <BillRowSkeletonList count={5} />
        </section>
      </main>
    </div>
  );
}

export function PaymentSettingsSkeleton() {
  return (
    <div className={ui.page}>
      <AppHeader activePage="settings" />
      <main className={ui.main} aria-busy="true">
        <p role="status" className="sr-only">
          Memuat pengaturan pembayaran…
        </p>
        <section className={`${ui.panel} space-y-3`} aria-hidden="true">
          <SkeletonBlock className="h-4 w-28 rounded-md" />
          <div className="flex items-center gap-3">
            <SkeletonBlock className="h-9 w-9 rounded-xl" />
            <SkeletonBlock className="h-6 w-44 rounded-md" />
          </div>
          <SkeletonBlock className="h-4 w-full rounded-md" />
          <SkeletonBlock className="h-3.5 w-4/5 rounded-md" />
        </section>
        <section className={`${ui.panel} space-y-3`} aria-hidden="true">
          {[0, 1].map((idx) => (
            <div
              key={idx}
              className="rounded-2xl border border-[#D8E2F2] bg-[#F8FAFF] p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <SkeletonBlock className="h-5 w-36 rounded-md" />
                <SkeletonBlock className="h-5 w-16 rounded-full" />
              </div>
              <SkeletonBlock className="h-4 w-56 max-w-full rounded-md" />
              <div className="flex gap-3 pt-1">
                <SkeletonBlock className="h-8 w-16 rounded-lg" />
                <SkeletonBlock className="h-8 w-28 rounded-lg" />
                <SkeletonBlock className="h-8 w-16 rounded-lg" />
              </div>
            </div>
          ))}
          <SkeletonBlock className="h-11 w-full rounded-xl" />
        </section>
      </main>
    </div>
  );
}

export function BillStepSkeleton({
  step = "review",
}: {
  step?: "review" | "split" | "result";
}) {
  const stepIndex = step === "review" ? 0 : step === "split" ? 1 : 2;
  return (
    <div className={`${ui.page} pb-32`}>
      <header className={ui.stepHeader} aria-hidden="true">
        <div className={ui.stepHeaderInner}>
          <div className={ui.stepTop}>
            <div className={ui.stepBill}>
              <SkeletonBlock className="h-11 w-11 rounded-xl shrink-0" />
              <div className="space-y-1.5">
                <SkeletonBlock className="h-4 w-32 rounded-md" />
                <SkeletonBlock className="h-3 w-24 rounded-md" />
              </div>
            </div>
            <SkeletonBlock className="h-6 w-20 rounded-full" />
          </div>
          <div className={ui.stepNav}>
            {["Cek struk", "Bagi pesanan", "Hasil"].map((label, idx) => (
              <span
                key={label}
                aria-current={idx === stepIndex ? "step" : undefined}
              >
                <span className={ui.stepCount}>{idx + 1}</span>
                <span>{label}</span>
              </span>
            ))}
          </div>
        </div>
      </header>

      <main className={ui.main} aria-busy="true">
        <p role="status" className="sr-only">
          Membuka tagihan…
        </p>
        <div className="space-y-2 px-0.5" aria-hidden="true">
          <SkeletonBlock className="h-7 w-52 rounded-md" />
          <SkeletonBlock className="h-4 w-72 max-w-full rounded-md" />
        </div>

        {step === "split" ? (
          <>
            <section className={`${ui.panel} space-y-3`} aria-hidden="true">
              <SkeletonBlock className="h-5 w-44 rounded-md" />
              <div className="flex gap-2">
                <SkeletonBlock className="h-11 flex-1 rounded-xl" />
                <SkeletonBlock className="h-11 w-28 rounded-xl" />
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <SkeletonBlock className="h-9 w-28 rounded-full" />
                <SkeletonBlock className="h-9 w-32 rounded-full" />
                <SkeletonBlock className="h-9 w-24 rounded-full" />
              </div>
            </section>
            <section className={`${ui.panel} space-y-3`} aria-hidden="true">
              <div className="flex items-center justify-between gap-2">
                <SkeletonBlock className="h-5 w-40 rounded-md" />
                <SkeletonBlock className="h-6 w-12 rounded-full" />
              </div>
              <SkeletonBlock className="h-12 w-full rounded-2xl" />
              {[0, 1, 2].map((idx) => (
                <SkeletonBlock key={idx} className="h-24 w-full rounded-2xl" />
              ))}
            </section>
          </>
        ) : step === "result" ? (
          <>
            <section className={`${ui.panel} space-y-3`} aria-hidden="true">
              <SkeletonBlock className="h-5 w-28 rounded-md" />
              <SkeletonBlock className="h-11 w-40 rounded-xl" />
            </section>
            <section className={`${ui.panel} space-y-3`} aria-hidden="true">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <SkeletonBlock className="h-5 w-24 rounded-full" />
                  <SkeletonBlock className="h-6 w-40 rounded-md" />
                  <SkeletonBlock className="h-3.5 w-32 rounded-md" />
                </div>
                <div className="space-y-1.5 text-right">
                  <SkeletonBlock className="h-3 w-20 rounded-md ml-auto" />
                  <SkeletonBlock className="h-6 w-28 rounded-md" />
                </div>
              </div>
              <SkeletonBlock className="h-16 w-full rounded-2xl" />
            </section>
            <section className={`${ui.panel} space-y-3`} aria-hidden="true">
              <SkeletonBlock className="h-5 w-44 rounded-md" />
              {[0, 1, 2].map((idx) => (
                <SkeletonBlock key={idx} className="h-16 w-full rounded-2xl" />
              ))}
            </section>
          </>
        ) : (
          <>
            <section className={`${ui.panel} space-y-3`} aria-hidden="true">
              <SkeletonBlock className="h-5 w-28 rounded-md" />
              <div className="flex items-center gap-3">
                <SkeletonBlock className="h-11 w-36 rounded-xl" />
                <SkeletonBlock className="h-4 w-44 rounded-md" />
              </div>
            </section>
            <section className={`${ui.panel} space-y-3`} aria-hidden="true">
              <SkeletonBlock className="h-5 w-32 rounded-md" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <SkeletonBlock className="h-11 w-full rounded-xl" />
                <SkeletonBlock className="h-11 w-full rounded-xl" />
              </div>
            </section>
            <section className={`${ui.panel} space-y-3`} aria-hidden="true">
              <SkeletonBlock className="h-5 w-36 rounded-md" />
              {[0, 1].map((idx) => (
                <div
                  key={idx}
                  className="rounded-2xl border border-[#D8E2F2] bg-[#F8FAFF] p-3.5 space-y-3"
                >
                  <div className="flex justify-between">
                    <SkeletonBlock className="h-5 w-20 rounded-lg" />
                    <SkeletonBlock className="h-8 w-16 rounded-lg" />
                  </div>
                  <SkeletonBlock className="h-11 w-full rounded-xl" />
                  <div className="grid grid-cols-12 gap-2.5">
                    <SkeletonBlock className="col-span-4 h-11 rounded-xl" />
                    <SkeletonBlock className="col-span-8 h-11 rounded-xl" />
                  </div>
                </div>
              ))}
            </section>
          </>
        )}
      </main>

      <div className={ui.actionBar} aria-hidden="true">
        <div className={ui.actionBarInner}>
          <div className="space-y-1.5">
            <SkeletonBlock className="h-4 w-32 rounded-md" />
            <SkeletonBlock className="h-3.5 w-24 rounded-md" />
          </div>
          <SkeletonBlock className="h-12 w-40 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

export function ProductLoading() {
  return <BillStepSkeleton step="review" />;
}
