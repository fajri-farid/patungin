import { ChevronDown, ReceiptText } from "lucide-react";
import { formatRupiah } from "@/domain/billing/money";
import type { ReceiptDetails as ReceiptDetailsData } from "@/domain/billing/types";

export function ReceiptDetails({ details, grandTotal }: { details: ReceiptDetailsData; grandTotal: number }) {
  return (
    <details className="group bg-white border border-[#D8E2F2] rounded-3xl shadow-xs overflow-hidden">
      <summary className="list-none min-h-[52px] p-4 sm:p-5 flex items-center gap-2 cursor-pointer text-sm font-bold text-[#2855D9] [&::-webkit-details-marker]:hidden">
        <ReceiptText className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 group-open:hidden">Lihat semua pesanan ({details.items.length})</span>
        <span className="flex-1 hidden group-open:block">Tutup rincian pesanan</span>
        <ChevronDown className="w-4 h-4 shrink-0 group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-[#D8E2F2] p-4 sm:p-5 space-y-4 text-sm">
        <ul aria-label="Semua pesanan" className="space-y-3">
          {details.items.map(item => (
            <li key={item.id} className="flex justify-between items-start gap-3">
              <span className="min-w-0 break-words">{item.quantity}× {item.name}</span>
              <span className="font-semibold tabular-money shrink-0">{formatRupiah(item.lineAmount)}</span>
            </li>
          ))}
        </ul>
        <dl className="border-t border-[#D8E2F2] pt-3 space-y-2 text-[#4A5B7C]">
          <div className="flex justify-between gap-3"><dt>Subtotal pesanan</dt><dd className="tabular-money shrink-0">{formatRupiah(details.subtotal)}</dd></div>
          {details.adjustments.map(adjustment => (
            <div key={adjustment.id} className="flex justify-between gap-3">
              <dt className="min-w-0 break-words">{adjustment.name}{adjustment.mode === "included" ? " (sudah termasuk)" : ""}</dt>
              <dd className="tabular-money shrink-0">{adjustment.mode === "included" ? "" : adjustment.signedAmount < 0 ? "−" : "+"}{formatRupiah(Math.abs(adjustment.signedAmount))}</dd>
            </div>
          ))}
          <div className="border-t border-[#D8E2F2] pt-3 flex justify-between gap-3 text-[#17233B] font-extrabold"><dt>Total tagihan</dt><dd className="tabular-money shrink-0">{formatRupiah(grandTotal)}</dd></div>
        </dl>
      </div>
    </details>
  );
}
