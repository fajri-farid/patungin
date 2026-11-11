"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { formatRupiah, isValidIdrInteger } from "@/domain/billing/money";
import { confirmReceiptItem, needsQuantityReview, receiptItemFeedback, unitPriceLineAmount, applyReceiptUnitPrice } from "@/domain/billing/receipt-review";
import type { BillItem } from "@/domain/billing/types";

export function ReceiptItemNotice({ item, items, locked, onChange, onMerge }: {
  item: BillItem;
  items: BillItem[];
  locked: boolean;
  onChange: (item: BillItem) => void;
  onMerge: (parentId: string) => void;
}) {
  const [parentId, setParentId] = useState(item.suggestedParentItemId ?? "");
  const feedback = receiptItemFeedback(item);
  if (!feedback.length) return null;
  const hasMismatch = feedback.some(f => f.code === "MISMATCH");
  const originalTotal = hasMismatch ? unitPriceLineAmount(item) : null;
  const canConfirm = isValidIdrInteger(item.lineAmount) && !needsQuantityReview(item) && Boolean(item.name.trim());
  const canMerge = items.length > 1 && (feedback.some(f => f.code === "MODIFIER") || !isValidIdrInteger(item.lineAmount));
  const parents = items.filter(other => other.id !== item.id && isValidIdrInteger(other.lineAmount));
  const buttonClass = "min-h-[44px] rounded-xl px-3 py-2 text-xs font-bold bg-white border border-[#E8CB83] text-[#9A4A12] disabled:opacity-40 cursor-pointer";

  return (
    <div id={`item-review-${item.id}`} className="rounded-xl border border-[#F5CA86] bg-[#FFF3E6] p-3 space-y-3 text-xs text-[#9A4A12]">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="space-y-1 leading-relaxed">
          {feedback.map(issue => <p key={issue.code}>{issue.message}</p>)}
        </div>
      </div>
      {!locked && <div className="flex flex-wrap gap-2">
        {needsQuantityReview(item) && <button type="button" className={buttonClass}
          onClick={() => onChange({ ...item, quantityStatus: "confirmed", unitMismatchConfirmed: false })}>
          Jumlah benar: {item.quantity}
        </button>}
        {canConfirm && <button type="button" className={buttonClass} onClick={() => onChange(confirmReceiptItem(item))}>
          {hasMismatch ? `Pakai total ${formatRupiah(item.lineAmount)}` : "Sesuai struk"}
        </button>}
        {originalTotal !== null && item.name.trim() && <button type="button" className={buttonClass}
          onClick={() => onChange(applyReceiptUnitPrice(item))}>
          Pakai harga asli {formatRupiah(item.unitPrice)}{item.quantity > 1 ? ` × ${item.quantity} = ${formatRupiah(originalTotal)}` : ""}
        </button>}
        <button type="button" className={buttonClass} onClick={() => document.getElementById("receipt-photo-reference")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
          Lihat struk
        </button>
      </div>}
      {!locked && canMerge && parents.length > 0 && <div className="space-y-2 border-t border-[#E8CB83] pt-3">
        <label htmlFor={`merge-parent-${item.id}`} className="block font-semibold">Sudah termasuk pesanan lain?</label>
        <select id={`merge-parent-${item.id}`} value={parents.some(p => p.id === parentId) ? parentId : ""}
          onChange={event => setParentId(event.target.value)} className="w-full min-h-[44px] rounded-xl border border-[#E8CB83] bg-white px-3 text-[#17233B]">
          <option value="">Pilih pesanan utamanya</option>
          {parents.map(parent => <option key={parent.id} value={parent.id}>{parent.name} — {formatRupiah(parent.lineAmount)}</option>)}
        </select>
        <button type="button" className={buttonClass} disabled={!parents.some(p => p.id === parentId)} onClick={() => onMerge(parentId)}>
          Gabungkan tanpa menambah harga
        </button>
        <p>Jika ditagih terpisah, isi harga tambahannya sesuai struk.</p>
      </div>}
    </div>
  );
}
