"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BookmarkCheck,
  ExternalLink,
  Landmark,
  Loader2,
  QrCode,
  RefreshCw,
  Star,
  Wallet,
} from "lucide-react";
import {
  getPaymentProfileAction,
  selectPaymentMethodsAction,
} from "@/app/actions/payment-settings";
import type { PaymentProfile } from "@/domain/payment-profile";
import type { PaymentMethodNote } from "@/domain/billing/types";
import { SavedMethodsInlineSkeleton } from "./product/ProductLoading";
import ui from "./product/product.module.css";

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
  const [loadingList, setLoadingList] = useState(false);
  const [pending, startTransition] = useTransition();

  function load() {
    setOpen(true);
    setError(null);
    setSelected([]);
    setLoadingList(true);
    onBusy?.(true);
    startTransition(async () => {
      try {
        const response = await getPaymentProfileAction();
        if (response.ok && response.data) {
          setProfile(response.data);
        } else {
          setProfile(null);
          setError(response.error ?? "Daftar belum bisa dimuat.");
        }
      } catch {
        setError("Periksa koneksi lalu coba lagi.");
      } finally {
        setLoadingList(false);
        onBusy?.(false);
      }
    });
  }

  return (
    <div className="rounded-2xl border border-[#D8E2F2] bg-[#F4F7FC] p-3.5 space-y-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          disabled={disabled || pending}
          onClick={load}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#C9DAFC] bg-white px-3.5 py-2 text-xs font-bold text-[#2855D9] hover:bg-[#E6EDFF] disabled:opacity-50 cursor-pointer"
        >
          {loadingList ? (
            <Loader2 size={15} className={ui.spinner} aria-hidden="true" />
          ) : (
            <BookmarkCheck size={16} aria-hidden="true" />
          )}
          {loadingList ? "Memuat daftar…" : "Pilih dari yang tersimpan"}
        </button>
        <Link
          href="/settings/payments"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1 px-2 text-xs font-semibold text-[#4A5B7C] hover:text-[#2855D9]"
        >
          <span>Kelola tujuan pembayaran</span>
          <ExternalLink size={13} aria-hidden="true" />
        </Link>
      </div>

      {open && (
        <div className="space-y-3 border-t border-[#D8E2F2] pt-3">
          <p className="text-xs text-[#4A5B7C]">
            Pilih rekening, e-wallet, atau QRIS milik orang yang membayar dulu. Pilihanmu akan ditambahkan ke tagihan ini.
          </p>

          {loadingList && <SavedMethodsInlineSkeleton />}

          {!loadingList && error && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#F5B5B5] bg-[#FDECEC] p-3 text-xs font-semibold text-[#B42318]"
            >
              <span className="inline-flex items-center gap-1.5">
                <AlertTriangle size={15} className="shrink-0" aria-hidden="true" />
                {error}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={load}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-white px-2.5 py-1 font-bold text-[#B42318] border border-[#F5B5B5] cursor-pointer"
              >
                <RefreshCw size={13} aria-hidden="true" />
                Muat ulang
              </button>
            </div>
          )}

          {!loadingList && profile?.methods.length === 0 && (
            <div className="rounded-xl border border-dashed border-[#D8E2F2] bg-white p-3.5 text-center text-xs text-[#4A5B7C]">
              Belum ada tujuan pembayaran tersimpan. Isi di bawah atau buka{" "}
              <Link
                href="/settings/payments"
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-[#2855D9] underline"
              >
                Pengaturan pembayaran
              </Link>
              .
            </div>
          )}

          {!loadingList &&
            profile &&
            profile.methods.length > 0 && (
              <div className="space-y-2">
                {profile.methods.map((method) => {
                  const isChecked = selected.includes(method.id);
                  const isDefault = profile.defaultMethodId === method.id;
                  const MethodIcon =
                    method.method === "qris"
                      ? QrCode
                      : method.method === "ewallet"
                        ? Wallet
                        : Landmark;
                  return (
                    <label
                      key={method.id}
                      className={`flex items-start gap-3 rounded-xl border p-3 transition-colors cursor-pointer ${
                        isChecked
                          ? "border-[#2855D9] bg-[#EEF4FF]"
                          : "border-[#D8E2F2] bg-white hover:border-[#B4C8EC]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-5 w-5"
                        disabled={disabled || pending}
                        checked={isChecked}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, method.id]
                              : current.filter((id) => id !== method.id),
                          )
                        }
                      />
                      <span className="min-w-0 flex-1 space-y-0.5">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <MethodIcon
                            size={14}
                            className="shrink-0 text-[#2855D9]"
                            aria-hidden="true"
                          />
                          <strong className="text-sm text-[#17233B]">
                            {method.label || method.bankOrWalletName || "QRIS"}
                          </strong>
                          {isDefault && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#E6EDFF] px-2 py-0.5 text-[11px] font-bold text-[#2855D9]">
                              <Star size={11} aria-hidden="true" />
                              Utama
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-[#4A5B7C]">
                          {method.method === "qris" ? (
                            "QRIS tersimpan"
                          ) : (
                            <>
                              {method.bankOrWalletName} ·{" "}
                              <span className="tabular-money font-semibold text-[#17233B]">
                                {method.accountNumber}
                              </span>{" "}
                              · a.n. {method.accountHolderName}
                            </>
                          )}
                        </span>
                        {method.note && (
                          <span className="block text-xs text-[#7687A6]">
                            {method.note}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              disabled={disabled || pending || !selected.length}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#2855D9] px-4 py-2 text-xs font-bold text-white hover:bg-[#1E44B8] disabled:opacity-50 cursor-pointer"
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
              {pending && !loadingList && (
                <Loader2 size={14} className={ui.spinner} aria-hidden="true" />
              )}
              Tambahkan ke tagihan{selected.length > 0 ? ` (${selected.length})` : ""}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setOpen(false)}
              className="min-h-11 rounded-xl border border-[#D8E2F2] bg-white px-3.5 py-2 text-xs font-bold text-[#4A5B7C] hover:text-[#17233B] cursor-pointer"
            >
              Tutup
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
