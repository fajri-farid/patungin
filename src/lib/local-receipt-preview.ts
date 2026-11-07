"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { RECEIPT_TTL_MS } from "@/domain/receipts";
const EVENT = "patungin-receipt-preview";
const key = (billId: string) => `patungin_receipt_preview_v1_${billId}`;
function notify() {
  window.dispatchEvent(new Event(EVENT));
}
export function rememberReceiptPreview(billId: string, dataUrl: string) {
  try {
    sessionStorage.setItem(
      key(billId),
      JSON.stringify({ dataUrl, expiresAt: Date.now() + RECEIPT_TTL_MS }),
    );
    notify();
  } catch {
    /* Optional tab-only recovery. */
  }
}
export function forgetReceiptPreview(billId: string) {
  try {
    sessionStorage.removeItem(key(billId));
    notify();
  } catch {
    /* Browser storage may be disabled. */
  }
}
function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
export function useReceiptPreview(billId: string) {
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return sessionStorage.getItem(key(billId));
      } catch {
        return null;
      }
    },
    () => null,
  );
  const preview = useMemo(() => {
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed &&
        typeof parsed.dataUrl === "string" &&
        parsed.dataUrl.startsWith("data:image/jpeg;base64,") &&
        Number.isFinite(parsed.expiresAt)
        ? (parsed as { dataUrl: string; expiresAt: number })
        : null;
    } catch {
      return null;
    }
  }, [raw]);
  useEffect(() => {
    if (!preview) return;
    const check = () => {
      if (Date.now() >= preview.expiresAt) forgetReceiptPreview(billId);
    };
    const timer = setTimeout(
      check,
      Math.max(0, preview.expiresAt - Date.now()),
    );
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [billId, preview]);
  return preview;
}
