"use client";

import { useRef, useState, useTransition } from "react";
import { GuardedLink as Link, NavigationGuard } from "@/components/NavigationGuard";
import { paymentEditorChanged } from "@/lib/payment-editor";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Landmark,
  Loader2,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  Star,
  Trash2,
  Wallet,
} from "lucide-react";
import { AppHeader } from "@/components/product/AppHeader";
import { PaymentMethodsEditor } from "@/components/PaymentMethods";
import { QrisImageUpload } from "@/components/QrisImageUpload";
import { QrisImage } from "@/components/QrisImage";
import {
  getPaymentProfileAction,
  savePaymentProfileAction,
} from "@/app/actions/payment-settings";
import type {
  PaymentProfile,
  PaymentProfileInput,
  SavedPaymentMethod,
} from "@/domain/payment-profile";
import type { PaymentMethodNote } from "@/domain/billing/types";
import ui from "@/components/product/product.module.css";

export function PaymentSettingsClient({
  initialProfile,
  email,
  admin = false,
}: {
  initialProfile: PaymentProfile;
  email: string;
  admin?: boolean;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [editor, setEditor] = useState<{
    id: string;
    label: string;
    payment: PaymentMethodNote;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [qrisBusy, setQrisBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const original = editor ? profile.methods.find((method) => method.id === editor.id) : undefined;
  const dirty = paymentEditorChanged(editor, original ? {
    id: original.id, label: original.label, payment: original,
  } : undefined);

  function save(input: PaymentProfileInput) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const response = await savePaymentProfileAction(
        profile.revision,
        input,
      ).catch(() => ({
        ok: false as const,
        data: undefined,
        error: "Periksa koneksi lalu coba simpan lagi.",
      }));
      if (!response.ok || !response.data) {
        setError(response.error ?? "Belum tersimpan.");
        return;
      }
      setProfile(response.data);
      setEditor(null);
      setNotice("Tujuan pembayaran tersimpan.");
    });
  }

  return (
    <NavigationGuard dirty={dirty} busy={pending || qrisBusy}>
    <div className={ui.page}>
      <AppHeader email={email} admin={admin} activePage="settings" />
      <main className={ui.main}>
        <section className={`${ui.panel} space-y-3`}>
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/app"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#D8E2F2] bg-[#F4F7FC] px-3 py-1.5 text-xs font-bold text-[#17233B] hover:bg-[#EAF0FA]"
            >
              <ArrowLeft size={15} aria-hidden="true" />
              Tagihan saya
            </Link>
            <span className="rounded-full bg-[#E6EDFF] px-2.5 py-1 text-xs font-bold text-[#2855D9] tabular-money">
              {profile.methods.length} / 10 tersimpan
            </span>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#E6EDFF] text-[#2855D9]">
              <Landmark size={20} aria-hidden="true" />
            </span>
            <div>
              <h1 className="font-display text-xl font-extrabold text-[#17233B]">
                Tujuan pembayaran
              </h1>
              <p className="text-xs text-[#4A5B7C]">
                Rekening, e-wallet, dan QRIS siap pakai
              </p>
            </div>
          </div>

          <p className="text-sm text-[#4A5B7C]">
            Simpan rekening, e-wallet, atau gambar QRIS agar tinggal dipilih
            saat patungan. Hanya tujuan pembayaran yang kamu pilih pada tagihan
            yang ikut dibagikan.
          </p>
          <p className="text-xs text-[#7687A6]">
            Perubahan di sini tidak mengubah tagihan lama. Default hanya menjadi
            rekomendasi saat memilih pada halaman hasil.
          </p>
        </section>

        {error && (
          <div
            role="alert"
            className={`${ui.error} flex flex-wrap items-center justify-between gap-3`}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              disabled={pending}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#F5B5B5] bg-white px-3 py-1.5 text-xs font-bold text-[#B42318] cursor-pointer"
              onClick={() => {
                if (
                  dirty &&
                  !window.confirm(
                    "Muat ulang pengaturan? Isian yang belum tersimpan akan dibatalkan.",
                  )
                )
                  return;
                startTransition(async () => {
                  const response = await getPaymentProfileAction().catch(
                    () => ({
                      ok: false as const,
                      data: undefined,
                      error: "Periksa koneksi lalu coba lagi.",
                    }),
                  );
                  if (response.ok && response.data) {
                    setProfile(response.data);
                    setEditor(null);
                    setError(null);
                  } else
                    setError(response.error ?? "Belum bisa memuat pengaturan.");
                });
              }}
            >
              <RefreshCw size={14} aria-hidden="true" />
              Muat ulang pengaturan
            </button>
          </div>
        )}

        {notice && (
          <div
            role="status"
            className="flex items-center gap-2.5 rounded-2xl border border-[#9ADBC3] bg-[#E6F5EF] px-4 py-3 text-sm font-bold text-[#146346]"
          >
            <CheckCircle2 size={18} className="shrink-0" aria-hidden="true" />
            <span>{notice}</span>
          </div>
        )}

        <section
          className={`${ui.panel} space-y-3.5`}
          aria-label="Tujuan pembayaran tersimpan"
        >
          <div className="flex items-center justify-between gap-2 pb-1">
            <h2 className={ui.sectionTitle}>Daftar tersimpan</h2>
          </div>

          {!profile.methods.length ? (
            <div className={ui.empty}>
              <div className={ui.emptyIconWrap} aria-hidden="true">
                <Wallet size={24} />
              </div>
              <h3>Belum ada tujuan pembayaran tersimpan.</h3>
              <p>
                Tambahkan rekening bank, e-wallet, atau QRIS di bawah agar
                tidak perlu mengetik ulang setiap selesai makan bareng.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {profile.methods.map((method) => {
                const isDefault = profile.defaultMethodId === method.id;
                const MethodIcon =
                  method.method === "qris"
                    ? QrCode
                    : method.method === "ewallet"
                      ? Wallet
                      : Landmark;
                return (
                  <div
                    key={method.id}
                    className={`rounded-2xl border p-4 space-y-3 transition-colors ${
                      isDefault
                        ? "border-[#9DC0FB] bg-[#F7FAFF]"
                        : "border-[#D8E2F2] bg-[#F4F7FC]/70"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white border border-[#D8E2F2] text-[#2855D9]">
                          <MethodIcon size={17} aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <strong className="block truncate text-sm font-extrabold text-[#17233B]">
                            {method.label || method.bankOrWalletName || "QRIS"}
                          </strong>
                          <span className="text-xs text-[#4A5B7C]">
                            {method.method === "qris"
                              ? "Kode QRIS"
                              : method.method === "ewallet"
                                ? "E-wallet"
                                : "Transfer bank"}
                          </span>
                        </div>
                      </div>

                      {isDefault && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#E6EDFF] px-2.5 py-1 text-xs font-bold text-[#2855D9]">
                          <Star size={12} aria-hidden="true" />
                          Default
                        </span>
                      )}
                    </div>

                    {method.method === "qris" && method.qrisImageId ? (
                      <details className="rounded-xl border border-[#D8E2F2] bg-white px-3.5 py-2 text-sm">
                        <summary className="flex min-h-10 cursor-pointer items-center font-bold text-xs text-[#2855D9]">
                          Lihat gambar QRIS
                        </summary>
                        <div className="pt-2.5 pb-1">
                          <QrisImage imageId={method.qrisImageId} />
                        </div>
                      </details>
                    ) : (
                      <div className="rounded-xl border border-[#E2EAF6] bg-white px-3.5 py-2.5 text-sm">
                        <p className="font-bold text-[#17233B]">
                          {method.bankOrWalletName}{" "}
                          <span className="tabular-money font-extrabold text-[#2855D9]">
                            · •••• {method.accountNumber?.slice(-4)}
                          </span>
                        </p>
                        <p className="text-xs text-[#4A5B7C]">
                          a.n. {method.accountHolderName}
                        </p>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 text-xs font-bold">
                      <button
                        type="button"
                        disabled={pending || !!editor}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[#D8E2F2] bg-white px-3 py-1.5 text-[#17233B] hover:border-[#2855D9] hover:text-[#2855D9] disabled:opacity-50 cursor-pointer"
                        onClick={() => {
                          setEditor({
                            id: method.id,
                            label: method.label,
                            payment: method,
                          });
                          setNotice(null);
                        }}
                      >
                        <Pencil size={14} aria-hidden="true" />
                        Edit
                      </button>

                      <button
                        type="button"
                        disabled={pending || !!editor}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[#D8E2F2] bg-white px-3 py-1.5 text-[#2855D9] hover:bg-[#E6EDFF] disabled:opacity-50 cursor-pointer"
                        onClick={() =>
                          save({
                            methods: profile.methods,
                            defaultMethodId: isDefault ? null : method.id,
                          })
                        }
                      >
                        <Star size={14} aria-hidden="true" />
                        {isDefault ? "Hapus default" : "Jadikan default"}
                      </button>

                      <button
                        type="button"
                        disabled={pending || !!editor}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[#D8E2F2] bg-white px-3 py-1.5 text-[#B42318] hover:border-[#F5B5B5] hover:bg-[#FDECEC] disabled:opacity-50 cursor-pointer"
                        onClick={() => {
                          if (
                            window.confirm(
                              "Hapus tujuan pembayaran tersimpan ini? Informasi yang sudah dipakai pada tagihan lama tetap ada.",
                            )
                          )
                            save({
                              methods: profile.methods.filter(
                                (saved) => saved.id !== method.id,
                              ),
                              defaultMethodId: isDefault
                                ? null
                                : profile.defaultMethodId,
                            });
                        }}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        Hapus
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!editor && profile.methods.length < 10 && (
            <button
              type="button"
              disabled={pending}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[#9DC0FB] bg-[#F8FAFF] px-4 py-3 text-sm font-bold text-[#2855D9] hover:bg-[#EEF4FF] disabled:opacity-50 cursor-pointer"
              onClick={() => {
                setEditor({
                  id: `pay_${crypto.randomUUID()}`,
                  label: "",
                  payment: { method: "bank" },
                });
                setNotice(null);
              }}
            >
              <Plus size={18} aria-hidden="true" />
              Tambah tujuan pembayaran
            </button>
          )}
        </section>

        {editor && (
          <form
            ref={formRef}
            className={`${ui.panel} space-y-4 border-[#9DC0FB]`}
            onSubmit={(event) => {
              event.preventDefault();
              if (qrisBusy || pending) return;
              if (!formRef.current?.reportValidity()) return;
              const method = {
                ...editor.payment,
                id: editor.id,
                label: editor.label,
              } as SavedPaymentMethod;
              const methods = profile.methods.some(
                (saved) => saved.id === editor.id,
              )
                ? profile.methods.map((saved) =>
                    saved.id === editor.id ? method : saved,
                  )
                : [...profile.methods, method];
              save({ methods, defaultMethodId: profile.defaultMethodId });
            }}
          >
            <h2 className={ui.sectionTitle}>
              {profile.methods.some((saved) => saved.id === editor.id)
                ? "Edit tujuan pembayaran"
                : "Tujuan pembayaran baru"}
            </h2>

            <label className="block space-y-1 text-xs font-semibold text-[#4A5B7C]">
              <span>Label (opsional)</span>
              <input
                autoFocus
                name="label"
                value={editor.label}
                maxLength={60}
                disabled={pending || qrisBusy}
                placeholder="Mis. BCA pribadi atau GoPay utama"
                className="min-h-11 w-full rounded-xl border border-[#D8E2F2] bg-white px-3 py-2 text-sm font-semibold text-[#17233B] focus:border-[#2855D9] focus:outline-none"
                onChange={(event) =>
                  setEditor({ ...editor, label: event.target.value })
                }
              />
            </label>

            <PaymentMethodsEditor
              value={[editor.payment]}
              allowQris
              allowAdd={false}
              disabled={pending || qrisBusy}
              renderQris={(payment) => (
                <QrisImageUpload
                  imageId={payment.qrisImageId}
                  disabled={pending}
                  onBusy={setQrisBusy}
                  onChange={(qrisImageId) =>
                    setEditor((current) =>
                      current
                        ? {
                            ...current,
                            payment: { ...current.payment, qrisImageId },
                          }
                        : null,
                    )
                  }
                />
              )}
              onChange={(values) =>
                values[0]
                  ? setEditor({ ...editor, payment: values[0] })
                  : setEditor(null)
              }
            />

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                disabled={pending || qrisBusy}
                type="submit"
                className={ui.primary}
              >
                {pending && (
                  <Loader2 size={16} className={ui.spinner} aria-hidden="true" />
                )}
                {pending ? "Menyimpan…" : "Simpan tujuan"}
              </button>
              <button
                disabled={pending || qrisBusy}
                type="button"
                className={ui.secondary}
                onClick={() => {
                  if (!dirty || window.confirm("Buang perubahan tujuan pembayaran yang belum tersimpan?")) setEditor(null);
                }}
              >
                Batal
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
    </NavigationGuard>
  );
}
