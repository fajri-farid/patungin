"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Landmark, Plus, Star, Trash2, Pencil } from "lucide-react";
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
}: {
  initialProfile: PaymentProfile;
  email: string;
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
  useEffect(() => {
    if (!editor) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editor]);

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
    <div className={ui.page}>
      <AppHeader email={email} />
      <main className={`${ui.main} space-y-5`}>
        <section className={`${ui.panel} space-y-3`}>
          <Link href="/app" className="text-sm font-bold text-[#2855D9]">
            ← Tagihan saya
          </Link>
          <div className="flex items-center gap-3">
            <Landmark className="text-[#2855D9]" aria-hidden="true" />
            <h1 className="text-xl font-extrabold font-display">
              Tujuan pembayaran
            </h1>
          </div>
          <p className="text-sm text-[#4A5B7C]">
            Simpan rekening, e-wallet, atau gambar QRIS agar tinggal dipilih
            saat patungan. Hanya tujuan pembayaran yang kamu pilih pada tagihan yang ikut
            dibagikan.
          </p>
          <p className="text-xs text-[#4A5B7C]">
            Perubahan di sini tidak mengubah tagihan lama. Maksimal 10 tujuan;
            default hanya menjadi rekomendasi saat memilih.
          </p>
        </section>
        {error && (
          <div
            role="alert"
            className={`${ui.panel} space-y-3 text-sm text-[#B42318]`}
          >
            <p>{error}</p>
            <button
              disabled={pending}
              className="min-h-11 font-bold underline"
              onClick={() => {
                if (
                  editor &&
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
              Muat ulang pengaturan
            </button>
          </div>
        )}
        {notice && (
          <p role="status" className={`${ui.panel} text-sm text-[#146346]`}>
            {notice}
          </p>
        )}
        <section
          className={`${ui.panel} space-y-3`}
          aria-label="Tujuan pembayaran tersimpan"
        >
          {!profile.methods.length && (
            <p className="text-sm text-[#4A5B7C]">
              Belum ada tujuan pembayaran tersimpan. Kamu tetap bisa mengisi pembayaran
              manual pada tagihan.
            </p>
          )}
          {profile.methods.map((method) => (
            <div
              key={method.id}
              className="rounded-2xl border border-[#D8E2F2] p-4 space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>
                  {method.label || method.bankOrWalletName || "QRIS"}
                </strong>
                {profile.defaultMethodId === method.id && (
                  <span className="text-xs font-bold text-[#2855D9]">
                    ★ Default
                  </span>
                )}
              </div>
              {method.method === "qris" && method.qrisImageId ? (
                <details className="text-sm">
                  <summary className="min-h-11 font-bold text-[#2855D9] cursor-pointer">
                    Lihat gambar QRIS
                  </summary>
                  <QrisImage imageId={method.qrisImageId} />
                </details>
              ) : (
                <p className="text-sm text-[#4A5B7C]">
                  {method.bankOrWalletName} · ••••{" "}
                  {method.accountNumber?.slice(-4)} · a.n.{" "}
                  {method.accountHolderName}
                </p>
              )}
              <div className="flex flex-wrap gap-3 text-xs font-bold">
                <button
                  disabled={pending || !!editor}
                  className="min-h-11 inline-flex items-center gap-1 text-[#2855D9] disabled:opacity-50"
                  onClick={() => {
                    setEditor({
                      id: method.id,
                      label: method.label,
                      payment: method,
                    });
                    setNotice(null);
                  }}
                >
                  <Pencil size={15} aria-hidden="true" /> Edit
                </button>
                <button
                  disabled={pending || !!editor}
                  className="min-h-11 inline-flex items-center gap-1 text-[#2855D9] disabled:opacity-50"
                  onClick={() =>
                    save({
                      methods: profile.methods,
                      defaultMethodId:
                        profile.defaultMethodId === method.id
                          ? null
                          : method.id,
                    })
                  }
                >
                  <Star size={15} aria-hidden="true" />
                  {profile.defaultMethodId === method.id
                    ? "Hapus default"
                    : "Jadikan default"}
                </button>
                <button
                  disabled={pending || !!editor}
                  className="min-h-11 inline-flex items-center gap-1 text-[#B42318] disabled:opacity-50"
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
                        defaultMethodId:
                          profile.defaultMethodId === method.id
                            ? null
                            : profile.defaultMethodId,
                      });
                  }}
                >
                  <Trash2 size={15} aria-hidden="true" /> Hapus
                </button>
              </div>
            </div>
          ))}
          {!editor && profile.methods.length < 10 && (
            <button
              disabled={pending}
              className="min-h-11 w-full rounded-xl border border-dashed border-[#A8C7FA] text-[#2855D9] font-bold inline-flex items-center justify-center gap-2"
              onClick={() => {
                setEditor({
                  id: `pay_${crypto.randomUUID()}`,
                  label: "",
                  payment: { method: "bank" },
                });
                setNotice(null);
              }}
            >
              <Plus size={18} aria-hidden="true" /> Tambah tujuan pembayaran
            </button>
          )}
        </section>
        {editor && (
          <form
            ref={formRef}
            className={`${ui.panel} space-y-4`}
            onSubmit={(event) => {
              event.preventDefault();
              if (qrisBusy) return;
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
            <h2 className="font-bold">
              {profile.methods.some((saved) => saved.id === editor.id)
                ? "Edit tujuan pembayaran"
                : "Tujuan pembayaran baru"}
            </h2>
            <label className="block text-sm space-y-1">
              <span>Label (opsional)</span>
              <input
                autoFocus
                name="label"
                value={editor.label}
                maxLength={60}
                disabled={pending || qrisBusy}
                placeholder="Mis. BCA pribadi"
                className="w-full min-h-11 rounded-xl border border-[#D8E2F2] px-3"
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
            <div className="flex gap-3">
              <button
                disabled={pending || qrisBusy}
                type="submit"
                className="min-h-11 rounded-xl px-5 bg-[#2855D9] text-white font-bold"
              >
                {pending ? "Menyimpan…" : "Simpan"}
              </button>
              <button
                disabled={pending || qrisBusy}
                type="button"
                className="min-h-11 px-4 font-bold text-[#4A5B7C]"
                onClick={() => setEditor(null)}
              >
                Batal
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
