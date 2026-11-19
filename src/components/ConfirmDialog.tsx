"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { AlertCircle, AlertTriangle, Loader2 } from "lucide-react";
import ui from "./product/product.module.css";
import styles from "./ConfirmDialog.module.css";

export type ConfirmTone = "danger" | "primary";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  pendingLabel?: string;
  retryLabel?: string;
  tone?: ConfirmTone;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export interface ConfirmRequest {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  pendingLabel?: string;
  retryLabel?: string;
  tone?: ConfirmTone;
  /** Return an error string to keep the dialog open and offer a retry action. */
  onConfirm: () => void | string | null | Promise<void | string | null>;
  /** Called right after the dialog closes on a successful confirmation (ideal for toasts). */
  onSuccess?: () => void;
}

/** Accessible in-app confirmation modal on desktop and bottom sheet on mobile. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Batal",
  pendingLabel = "Memproses…",
  retryLabel = "Coba lagi",
  tone = "danger",
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <ConfirmDialogModal
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      pendingLabel={pendingLabel}
      retryLabel={retryLabel}
      tone={tone}
      busy={busy}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

function ConfirmDialogModal({
  title,
  description,
  confirmLabel,
  cancelLabel,
  pendingLabel,
  retryLabel,
  tone,
  busy,
  error,
  onConfirm,
  onCancel,
}: Omit<ConfirmDialogProps, "open"> & {
  cancelLabel: string;
  pendingLabel: string;
  retryLabel: string;
  tone: ConfirmTone;
  busy: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const backdropPointer = useRef<number | null>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descId = `${baseId}-desc`;
  const errorId = `${baseId}-error`;

  function isBackdrop(event: PointerEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return false;
    const bounds = event.currentTarget.getBoundingClientRect();
    return (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    );
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
    if (tone === "danger") {
      cancelButtonRef.current?.focus({ preventScroll: true });
    }
    return () => {
      if (dialog?.open) dialog.close();
      requestAnimationFrame(() => {
        if (document.querySelector("dialog[open]")) return;
        if (trigger && trigger.isConnected && trigger.getClientRects().length > 0) {
          trigger.focus({ preventScroll: true });
        }
      });
    };
  }, [tone]);

  const activeConfirmLabel = busy
    ? pendingLabel
    : error
      ? retryLabel
      : confirmLabel;

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={error ? `${descId} ${errorId}` : descId}
      aria-busy={busy}
      onPointerDown={(event) => {
        backdropPointer.current =
          event.isPrimary && event.button === 0 && isBackdrop(event)
            ? event.pointerId
            : null;
      }}
      onPointerUp={(event) => {
        const close =
          backdropPointer.current === event.pointerId && isBackdrop(event);
        backdropPointer.current = null;
        if (close && !busy) onCancel();
      }}
      onPointerCancel={() => {
        backdropPointer.current = null;
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <div className={styles.content}>
        <div className={styles.handle} aria-hidden="true" />

        <div className="flex items-start gap-3">
          <span
            className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border ${
              tone === "danger"
                ? "bg-[#FDECEC] text-[#B42318] border-[#F5B5B5]"
                : "bg-[#E6EDFF] text-[#2855D9] border-[#C9DAFC]"
            }`}
            aria-hidden="true"
          >
            {tone === "danger" ? (
              <AlertTriangle className="w-5 h-5" />
            ) : (
              <AlertCircle className="w-5 h-5" />
            )}
          </span>

          <div className="min-w-0 space-y-1.5 pt-0.5">
            <h2
              id={titleId}
              className="font-display text-[17px] sm:text-[18px] font-extrabold tracking-[-0.025em] text-[#17233B] leading-snug"
            >
              {title}
            </h2>
            <div
              id={descId}
              className="text-sm text-[#4A5B7C] leading-relaxed break-words"
            >
              {description}
            </div>
          </div>
        </div>

        {error && (
          <div
            id={errorId}
            role="alert"
            className={`${ui.error} flex items-start gap-2.5`}
          >
            <AlertTriangle
              size={18}
              className="mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-col gap-2.5 sm:flex-row-reverse sm:justify-start">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onConfirm()}
            className={`${
              tone === "danger" ? styles.dangerButton : ui.primary
            } w-full sm:w-auto`}
          >
            {busy && (
              <Loader2 size={16} className={ui.spinner} aria-hidden="true" />
            )}
            {activeConfirmLabel}
          </button>

          <button
            ref={cancelButtonRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className={`${ui.secondary} w-full sm:w-auto`}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/** State helper so callers keep synchronous and async confirmations uniform. */
export function useConfirmDialog() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const ask = useCallback((nextRequest: ConfirmRequest) => {
    if (inFlight.current) return;
    setError(null);
    setBusy(false);
    setRequest(nextRequest);
  }, []);

  const close = useCallback(() => {
    if (inFlight.current) return;
    setError(null);
    setBusy(false);
    setRequest(null);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!request || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const failureMessage = await request.onConfirm();
      if (typeof failureMessage === "string" && failureMessage.trim()) {
        setError(failureMessage);
        return;
      }
      const afterSuccess = request.onSuccess;
      setRequest(null);
      if (afterSuccess) {
        if (
          typeof window !== "undefined" &&
          typeof window.requestAnimationFrame === "function"
        ) {
          window.requestAnimationFrame(() => {
            afterSuccess();
          });
        } else {
          afterSuccess();
        }
      }
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim()
          ? err.message
          : "Belum berhasil. Periksa koneksi lalu coba lagi.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [request]);

  return {
    ask,
    close,
    busy,
    dialog: request ? (
      <ConfirmDialog
        open
        title={request.title}
        description={request.description}
        confirmLabel={request.confirmLabel}
        cancelLabel={request.cancelLabel}
        pendingLabel={request.pendingLabel}
        retryLabel={request.retryLabel}
        tone={request.tone ?? "danger"}
        busy={busy}
        error={error}
        onConfirm={handleConfirm}
        onCancel={close}
      />
    ) : null,
  };
}
