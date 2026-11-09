import { ChevronDown, ReceiptText } from "lucide-react";
import { formatRupiah } from "@/domain/billing/money";
import type { ReceiptDetails as ReceiptDetailsData } from "@/domain/billing/types";
import ui from "./product/product.module.css";

export function ReceiptDetails({
  details,
  grandTotal,
}: {
  details: ReceiptDetailsData;
  grandTotal: number;
}) {
  return (
    <details className={`group ${ui.panel} !p-0 overflow-hidden`}>
      <summary className="list-none min-h-[54px] px-4 py-3.5 sm:px-5 flex items-center gap-2.5 cursor-pointer text-sm font-bold text-[#2855D9] hover:bg-[#F8FAFF] transition-colors [&::-webkit-details-marker]:hidden">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#E6EDFF] text-[#2855D9]">
          <ReceiptText className="w-4 h-4" aria-hidden="true" />
        </span>
        <span className="flex-1 group-open:hidden">
          Lihat semua pesanan ({details.items.length})
        </span>
        <span className="flex-1 hidden group-open:block">
          Tutup rincian pesanan
        </span>
        <ChevronDown
          className="w-4 h-4 shrink-0 transition-transform duration-200 group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="border-t border-[#D8E2F2] p-4 sm:p-5 space-y-4 text-sm bg-[#FCFDFE]">
        <ul aria-label="Semua pesanan" className="space-y-2.5">
          {details.items.map((item) => (
            <li
              key={item.id}
              className="flex justify-between items-start gap-3"
            >
              <span className="min-w-0 break-words text-[#17233B]">
                <strong className="tabular-money font-bold text-[#4A5B7C]">
                  {item.quantity}×
                </strong>{" "}
                {item.name}
              </span>
              <span className="font-bold text-[#17233B] tabular-money shrink-0">
                {formatRupiah(item.lineAmount)}
              </span>
            </li>
          ))}
        </ul>
        <dl className="border-t border-dashed border-[#D8E2F2] pt-3 space-y-2 text-[#4A5B7C]">
          <div className="flex justify-between gap-3">
            <dt>Subtotal pesanan</dt>
            <dd className="tabular-money font-semibold text-[#17233B] shrink-0">
              {formatRupiah(details.subtotal)}
            </dd>
          </div>
          {details.adjustments.map((adjustment) => (
            <div key={adjustment.id} className="flex justify-between gap-3">
              <dt className="min-w-0 break-words">
                {adjustment.name}
                {adjustment.mode === "included" ? " (sudah termasuk)" : ""}
              </dt>
              <dd className="tabular-money font-semibold shrink-0">
                {adjustment.mode === "included"
                  ? ""
                  : adjustment.signedAmount < 0
                    ? "−"
                    : "+"}
                {formatRupiah(Math.abs(adjustment.signedAmount))}
              </dd>
            </div>
          ))}
          <div className="border-t border-dashed border-[#D8E2F2] pt-3 flex justify-between gap-3 text-[#17233B] font-extrabold text-base">
            <dt>Total tagihan</dt>
            <dd className="tabular-money shrink-0">
              {formatRupiah(grandTotal)}
            </dd>
          </div>
        </dl>
      </div>
    </details>
  );
}
