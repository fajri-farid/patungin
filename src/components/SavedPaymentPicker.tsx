"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import {
  getPaymentProfileAction,
  selectPaymentMethodsAction,
} from "@/app/actions/payment-settings";
import type { PaymentProfile } from "@/domain/payment-profile";
import type { PaymentMethodNote } from "@/domain/billing/types";

export function SavedPaymentPicker({
  disabled,
  onUse,
  onBusy,
}: {
  disabled?: boolean;
  onUse: (methods: PaymentMethodNote[]) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<PaymentProfile | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function load() {
    setOpen(true);
    setError(null);
    setSelected([]);
    onBusy?.(true);
    startTransition(async () => {
      try {
        const response = await getPaymentProfileAction();
        if (response.ok && response.data) setProfile(response.data);
        else {
          setProfile(null);
          setError(response.error ?? "Daftar belum bisa dimuat.");
        }
      } catch {
        setError("Periksa koneksi lalu coba lagi.");
      } finally {
        onBusy?.(false);
      }
    });
  }
  return (
    <div className="rounded-2xl bg-[#F4F7FC] border border-[#D8E2F2] p-3 space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          disabled={disabled || pending}
          onClick={load}
          className="min-h-11 font-bold text-[#2855D9]"
        >
          {pending ? "Memuat…" : "Pilih dari yang tersimpan"}
        </button>
        <Link
          href="/settings/payments"
          target="_blank"
          rel="noopener noreferrer"
          className="min-h-11 inline-flex items-center text-xs underline text-[#4A5B7C]"
        >
          Kelola tujuan pembayaran ↗
        </Link>
      </div>
      {open && (
        <div className="space-y-3">
          <p className="text-xs text-[#4A5B7C]">
            Pastikan tujuan pembayaran sesuai dengan orang yang menalangi
            tagihan. Pilihan ini tidak mengubah isian manualmu.
          </p>
          {error && (
            <p role="alert" className="text-[#B42318]">
              {error}{" "}
              <button
                type="button"
                disabled={pending}
                onClick={load}
                className="underline"
              >
                Muat ulang
              </button>
            </p>
          )}
          {profile?.methods.length === 0 && (
            <p>
              Belum ada rekening tersimpan. Isi manual atau tambahkan melalui
              pengaturan.
            </p>
          )}
          {profile?.methods.map((method) => (
            <label
              key={method.id}
              className="flex items-start gap-3 rounded-xl bg-white border border-[#D8E2F2] p-3 cursor-pointer"
            >
              <input
                type="checkbox"
                className="mt-1 w-5 h-5"
                disabled={disabled || pending}
                checked={selected.includes(method.id)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, method.id]
                      : current.filter((id) => id !== method.id),
                  )
                }
              />
              <span>
                <strong className="block">
                  {method.label || method.bankOrWalletName || "QRIS"}
                  {profile.defaultMethodId === method.id ? " · Default" : ""}
                </strong>
                <span className="block text-xs">
                  {method.method === "qris" ? "QRIS dengan gambar tersimpan" : <>{method.bankOrWalletName} · {method.accountNumber} · a.n. {method.accountHolderName}</>}
                </span>
                {method.note && (
                  <span className="block text-xs">{method.note}</span>
                )}
              </span>
            </label>
          ))}
          <div className="flex gap-3">
            <button
              type="button"
              disabled={disabled || pending || !selected.length}
              className="min-h-11 rounded-xl px-4 bg-[#2855D9] text-white font-bold disabled:opacity-50"
              onClick={() => {
                setError(null);
                onBusy?.(true);
                startTransition(async () => {
                  try {
                    const response = await selectPaymentMethodsAction(selected);
                    if (response.ok && response.data) {
                      onUse(response.data);
                      setOpen(false);
                    } else
                      setError(
                        response.error ?? "Pilihan belum bisa digunakan.",
                      );
                  } catch {
                    setError("Periksa koneksi lalu coba lagi.");
                  } finally {
                    onBusy?.(false);
                  }
                });
              }}
            >
              Gunakan pilihan
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setOpen(false)}
              className="min-h-11 px-3"
            >
              Tutup
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
