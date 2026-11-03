"use client";

import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type PointerEvent,
} from "react";
import { X } from "lucide-react";
import styles from "./admin.module.css";

export function AdminDialog({
  title,
  description,
  children,
  onClose,
  busy = false,
  eyebrow = "PENGELOLAAN AKUN",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  eyebrow?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropPointer = useRef<number | null>(null);
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
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      requestAnimationFrame(() => {
        if (document.querySelector("dialog[open]")) return;
        const visible = (element: HTMLElement) =>
          element.isConnected && element.getClientRects().length > 0;
        // A responsive table/card switch can hide the original button while
        // this panel is open. Restore focus to its visible equivalent instead.
        const label = trigger?.getAttribute("aria-label");
        const target =
          trigger && visible(trigger)
            ? trigger
            : label
              ? Array.from(
                  document.querySelectorAll<HTMLElement>("[aria-label]"),
                ).find(
                  (element) =>
                    element.getAttribute("aria-label") === label &&
                    visible(element),
                )
              : null;
        target?.focus({ preventScroll: true });
      });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={id}
      aria-describedby={description ? `${id}-description` : undefined}
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
        if (close && !busy) onClose();
      }}
      onPointerCancel={() => {
        backdropPointer.current = null;
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className={styles.dialogHeader}>
        <div>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h2 id={id}>{title}</h2>
          {description && <p id={`${id}-description`}>{description}</p>}
        </div>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Tutup panel"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <div className={styles.dialogBody}>{children}</div>
    </dialog>
  );
}
