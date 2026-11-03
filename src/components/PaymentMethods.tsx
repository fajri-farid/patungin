"use client";

import { useState } from "react";
import {
  Check,
  Copy,
  Landmark,
  Plus,
  QrCode,
  Trash2,
  Wallet,
} from "lucide-react";
import type { PaymentMethodNote } from "@/domain/billing/types";
import {
  editablePaymentMethod,
  MAX_PAYMENT_METHODS,
  paymentMethodLabel,
} from "@/domain/billing/payment";

const inputClass =
  "w-full min-h-[44px] rounded-xl border border-[#D8E2F2] bg-white px-3 py-2 text-sm text-[#17233B]";
const methods = [
  { value: "bank", label: "Bank", Icon: Landmark },
  { value: "ewallet", label: "E-wallet", Icon: Wallet },
  { value: "qris", label: "QRIS", Icon: QrCode },
] as const;

export function PaymentMethodsEditor({
  value,
  onChange,
  disabled,
}: {
  value: PaymentMethodNote[];
  onChange: (value: PaymentMethodNote[]) => void;
  disabled?: boolean;
}) {
  const update = (index: number, patch: Partial<PaymentMethodNote>) => {
    onChange(
      value.map((payment, i) =>
        i === index ? { ...payment, ...patch } : payment,
      ),
    );
  };
  return (
    <fieldset disabled={disabled} className="space-y-3 disabled:opacity-60">
      <legend className="sr-only">Tujuan pembayaran</legend>
      {value.map((payment, index) => (
        <div
          key={index}
          className="rounded-2xl border border-[#D8E2F2] bg-[#F4F7FC] p-3.5 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold">
              Tujuan pembayaran {index + 1}
            </span>
            <button
              type="button"
              onClick={() => onChange(value.filter((_, i) => i !== index))}
              aria-label={`Hapus tujuan pembayaran ${index + 1}`}
              className="w-11 h-11 rounded-xl text-[#B42318] hover:bg-[#FDECEC] inline-flex items-center justify-center cursor-pointer"
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
          <div
            className="grid grid-cols-3 gap-1 rounded-xl bg-white border border-[#D8E2F2] p-1"
            role="group"
            aria-label={`Jenis pembayaran ${index + 1}`}
          >
            {methods.map(({ value: method, label, Icon }) => (
              <button
                type="button"
                key={method}
                aria-pressed={
                  (payment.method === "transfer" || !payment.method
                    ? "bank"
                    : payment.method) === method
                }
                onClick={() =>
                  onChange(
                    value.map((current, i) =>
                      i === index
                        ? { method, note: current.note ?? "" }
                        : current,
                    ),
                  )
                }
                className={`min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-bold cursor-pointer ${
                  (payment.method === "transfer" || !payment.method
                    ? "bank"
                    : payment.method) === method
                    ? "bg-[#2855D9] text-white"
                    : "text-[#4A5B7C] hover:bg-[#EAF0FA]"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          {payment.method === "qris" ? (
            <p className="text-sm text-[#4A5B7C] leading-relaxed">
              Bagikan kode QRIS lewat chat. Di rincian ini, teman akan diminta
              menghubungimu untuk mendapatkan kodenya.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-semibold text-[#4A5B7C] sm:col-span-2">
                <span>
                  {payment.method === "ewallet" ? "Nama e-wallet" : "Nama bank"}
                </span>
                <input
                  className={inputClass}
                  name={`payment-${index}-provider`}
                  autoComplete="off"
                  value={payment.bankOrWalletName ?? ""}
                  maxLength={80}
                  required
                  placeholder={
                    payment.method === "ewallet"
                      ? "Mis. GoPay, OVO, atau DANA"
                      : "Mis. BCA, Mandiri, atau BRI"
                  }
                  onChange={(event) =>
                    update(index, { bankOrWalletName: event.target.value })
                  }
                />
              </label>
              <label className="space-y-1 text-xs font-semibold text-[#4A5B7C]">
                <span>
                  {payment.method === "ewallet"
                    ? "Nomor HP e-wallet"
                    : "Nomor rekening"}
                </span>
                <input
                  className={inputClass}
                  name={`payment-${index}-number`}
                  autoComplete="off"
                  value={payment.accountNumber ?? ""}
                  maxLength={64}
                  inputMode="numeric"
                  required
                  onChange={(event) =>
                    update(index, { accountNumber: event.target.value })
                  }
                />
              </label>
              <label className="space-y-1 text-xs font-semibold text-[#4A5B7C]">
                <span>Atas nama</span>
                <input
                  className={inputClass}
                  name={`payment-${index}-holder`}
                  autoComplete="off"
                  value={payment.accountHolderName ?? ""}
                  maxLength={100}
                  required
                  onChange={(event) =>
                    update(index, { accountHolderName: event.target.value })
                  }
                />
              </label>
            </div>
          )}
          <label className="block space-y-1 text-xs font-semibold text-[#4A5B7C]">
            <span>Catatan (opsional)</span>
            <input
              className={inputClass}
              name={`payment-${index}-note`}
              autoComplete="off"
              value={payment.note ?? ""}
              maxLength={300}
              placeholder="Mis. Kabari setelah bayar, ya"
              onChange={(event) => update(index, { note: event.target.value })}
            />
          </label>
        </div>
      ))}
      {value.length < MAX_PAYMENT_METHODS && (
        <button
          type="button"
          onClick={() => onChange([...value, { method: "bank" }])}
          className="w-full min-h-[44px] border border-dashed border-[#A8C7FA] rounded-xl text-[#2855D9] text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer hover:bg-[#E6EDFF]"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          {value.length
            ? "Tambah tujuan pembayaran"
            : "Tambah rekening, e-wallet, atau QRIS"}
        </button>
      )}
    </fieldset>
  );
}

export function PaymentMethodsList({
  payments,
  payerName,
}: {
  payments: PaymentMethodNote[];
  payerName: string;
}) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copyError, setCopyError] = useState(false);
  const copy = async (payment: PaymentMethodNote, index: number) => {
    try {
      await navigator.clipboard.writeText(payment.accountNumber ?? "");
      setCopyError(false);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2500);
    } catch {
      setCopyError(true);
    }
  };
  if (!payments.length) return null;
  return (
    <div className="space-y-2.5">
      {payments.length > 1 && (
        <p className="text-sm text-[#4A5B7C]">
          Pilih salah satu tujuan pembayaran.
        </p>
      )}
      {payments.map(editablePaymentMethod).map((payment, index) => {
        const Icon =
          payment.method === "qris"
            ? QrCode
            : payment.method === "ewallet"
              ? Wallet
              : Landmark;
        return (
          <div
            key={index}
            className="rounded-xl border border-[#D8E2F2] bg-[#F4F7FC] p-3.5 space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-[#4A5B7C] inline-flex items-center gap-2">
                <Icon className="w-4 h-4" aria-hidden="true" />
                {paymentMethodLabel(payment)}
              </p>
              {payment.method !== "qris" && payment.accountNumber && (
                <button
                  type="button"
                  onClick={() => copy(payment, index)}
                  className="min-h-[44px] rounded-lg px-3 text-xs font-bold text-[#2855D9] bg-white border border-[#D8E2F2] inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedIndex === index ? (
                    <Check className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <Copy className="w-4 h-4" aria-hidden="true" />
                  )}
                  {copiedIndex === index
                    ? "Tersalin"
                    : payment.method === "ewallet"
                      ? "Salin nomor HP"
                      : "Salin rekening"}
                </button>
              )}
            </div>
            {payment.method === "qris" ? (
              <p className="text-sm text-[#4A5B7C]">
                Minta kode QRIS ke {payerName} lewat chat.
              </p>
            ) : (
              <div className="space-y-0.5 text-sm break-words">
                <p className="font-bold">{payment.bankOrWalletName}</p>
                <p className="font-extrabold tabular-money select-all">
                  {payment.accountNumber}
                </p>
                {payment.accountHolderName && (
                  <p className="text-[#4A5B7C]">
                    a.n. {payment.accountHolderName}
                  </p>
                )}
              </div>
            )}
            {payment.note && (
              <p className="text-sm text-[#4A5B7C] break-words">
                {payment.note}
              </p>
            )}
          </div>
        );
      })}
      <p role="status" className="text-xs text-[#4A5B7C]">
        {copyError
          ? "Belum bisa menyalin. Tekan dan tahan nomor untuk menyalinnya."
          : copiedIndex !== null
            ? "Nomor berhasil disalin."
            : ""}
      </p>
    </div>
  );
}
