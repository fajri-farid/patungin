"use client";

import { useEffect, useRef, useState } from "react";
import { Wallet } from "lucide-react";
import type { PaymentMethodNote } from "@/domain/billing/types";
import type { SaveStatus } from "./StepHeader";
import { PaymentMethodsEditor, PaymentMethodsList } from "./PaymentMethods";
import { SavedPaymentPicker } from "./SavedPaymentPicker";
import ui from "./product/product.module.css";

export function ResultPaymentMethods({
  finalized,
  payments,
  payerName,
  busy,
  saveStatus,
  error,
  onChange,
  onUseSaved,
  onPickerBusy,
}: {
  finalized: boolean;
  payments: PaymentMethodNote[];
  payerName: string;
  busy: boolean;
  saveStatus: SaveStatus;
  error: string | null;
  onChange: (payments: PaymentMethodNote[]) => void;
  onUseSaved: (payments: PaymentMethodNote[]) => void;
  onPickerBusy: (busy: boolean) => void;
}) {
  const [editorOpened, setEditorOpened] = useState(false);
  const editor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorOpened) editor.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [editorOpened]);

  return (
    <section
      id="payment-settings"
      aria-labelledby="heading-payment-methods"
      tabIndex={-1}
      className={`${ui.panel} space-y-3.5 scroll-mt-36`}
    >
      <div className="flex items-start gap-2.5 border-b border-[#D8E2F2] pb-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#E6EDFF] text-[#2855D9]">
          <Wallet className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id="heading-payment-methods" className={ui.sectionTitle}>
            Cara bayar yang ikut dibagikan
          </h2>
          {!finalized && (
            <p className="mt-0.5 text-xs text-[#4A5B7C]">
              Opsional. Pilihan di bawah akan ikut setelah hasil disimpan.
            </p>
          )}
        </div>
      </div>

      {finalized ? (
        payments.length ? (
          <PaymentMethodsList payments={payments} payerName={payerName} />
        ) : (
          <div className="space-y-1 rounded-2xl border border-[#D8E2F2] bg-[#F4F7FC] p-3.5 text-xs text-[#4A5B7C]">
            <p className="font-bold">Cara bayar belum dicantumkan.</p>
            <p>Hubungi {payerName} untuk cara pembayaran.</p>
            <p>Untuk menambahkannya, pilih Ubah tagihan.</p>
          </div>
        )
      ) : (
        <>
          {!payments.length && (
            <div className="space-y-2.5">
              <p className="text-sm text-[#4A5B7C]">
                Tambahkan cara bayar agar teman mudah transfer.
              </p>
              {!editorOpened && (
                <button
                  type="button"
                  disabled={busy}
                  aria-expanded={false}
                  aria-controls="payment-editor"
                  className={ui.secondary}
                  onClick={() => setEditorOpened(true)}
                >
                  Tambah cara bayar
                </button>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="rounded-2xl border border-[#F5B5B5] bg-[#FDECEC] p-3 text-xs font-bold text-[#B42318]">
              {error}
            </p>
          )}
          <div
            id="payment-editor"
            ref={editor}
            hidden={!payments.length && !editorOpened}
            className="space-y-3.5"
          >
            <SavedPaymentPicker disabled={busy} onBusy={onPickerBusy} onUse={onUseSaved} />
            <PaymentMethodsEditor
              value={payments}
              disabled={busy}
              onChange={(value) => {
                if (!value.length) setEditorOpened(true);
                onChange(value);
              }}
            />
          </div>
          {!!payments.length && saveStatus !== "saved" && (
            <p role="status" className="text-xs text-[#4A5B7C]">
              {saveStatus === "saving"
                ? "Menyimpan cara bayar…"
                : saveStatus === "error"
                  ? "Cara bayar belum tersimpan. Coba simpan lagi."
                  : "Perubahan cara bayar belum disimpan."}
            </p>
          )}
        </>
      )}
    </section>
  );
}
