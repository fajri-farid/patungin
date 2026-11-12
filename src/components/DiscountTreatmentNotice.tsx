"use client";

import { formatRupiah } from "@/domain/billing/money";
import type { BillAdjustment } from "@/domain/billing/types";

export function DiscountTreatmentNotice({ adjustment, locked, onSubtract, onAlreadyIncluded }: {
  adjustment: BillAdjustment;
  locked: boolean;
  onSubtract: () => void;
  onAlreadyIncluded: () => void;
}) {
  if (!adjustment.discountNeedsReview) return null;
  const buttonClass = "min-h-[44px] rounded-xl border border-[#E8CB83] bg-white px-3 py-2 text-xs font-bold disabled:opacity-40 cursor-pointer";
  return (
    <div className="rounded-xl border border-[#E8CB83] bg-[#FFF8E7] p-3 text-xs text-[#9A4A12] space-y-2" role="alert">
      <p>Diskon {formatRupiah(adjustment.amount)} ini masih perlu dipotong, atau sudah masuk harga pesanan? Cocokkan dengan struk.</p>
      {!locked && <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} onClick={onSubtract}>Potong dari harga pesanan</button>
        <button type="button" className={buttonClass} onClick={onAlreadyIncluded}>Sudah masuk harga pesanan</button>
      </div>}
    </div>
  );
}
