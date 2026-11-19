"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
  type ReactNode,
} from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import {
  computeToastSwipeOffset,
  createToastStore,
  evaluateToastSwipeDismiss,
  resolveToastSwipeAxis,
  TOAST_EXIT_DURATION_MS,
  toastAriaRole,
  toastLiveMode,
  type PersistedToast,
  type ToastItem,
  type ToastOptions,
  type ToastStore,
  type ToastSwipeAxis,
  type ToastSwipeExit,
} from "@/lib/toast-store";
import styles from "./ToastProvider.module.css";

export interface ToastApi {
  success: (message: string, options?: ToastOptions) => string;
  info: (message: string, options?: ToastOptions) => string;
  error: (message: string, options?: ToastOptions) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const STORAGE_KEY = "patungin_active_toasts_v1";
const EMPTY_TOASTS: readonly ToastItem[] = [];

const NOOP_TOAST_API: ToastApi = {
  success: () => "",
  info: () => "",
  error: () => "",
  dismiss: () => {},
  clear: () => {},
};

let clientStore: ToastStore | null = null;
let storageRestored = false;

const SERVER_NOOP_STORE: ToastStore = {
  push: () => "",
  dismiss: () => {},
  pause: () => {},
  resume: () => {},
  clear: () => {},
  getPersistable: () => [],
  restorePersisted: () => {},
  subscribe: () => () => {},
  getSnapshot: () => EMPTY_TOASTS,
};

function persistActiveToasts(store: ToastStore) {
  if (typeof window === "undefined") return;
  try {
    const active = store.getPersistable();
    if (active.length === 0) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(active));
  } catch {
    /* sessionStorage may be unavailable in restricted browsing modes. */
  }
}

function getClientToastStore(): ToastStore {
  if (typeof window === "undefined") return SERVER_NOOP_STORE;
  if (!clientStore) {
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const store = createToastStore({
      exitDurationMs: reducedMotion ? 0 : TOAST_EXIT_DURATION_MS,
    });
    store.subscribe(() => {
      persistActiveToasts(store);
    });
    clientStore = store;
  }
  return clientStore;
}

function restorePersistedToasts(store: ToastStore) {
  if (storageRestored || typeof window === "undefined") return;
  storageRestored = true;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    window.sessionStorage.removeItem(STORAGE_KEY);
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      store.restorePersisted(parsed as PersistedToast[]);
    }
  } catch {
    /* Ignore malformed or inaccessible storage entries. */
  }
}

interface PointerDragSession {
  pointerId: number;
  startX: number;
  startY: number;
  startTime: number;
  width: number;
  axis: ToastSwipeAxis | null;
  captured: boolean;
}

interface SwipeVisualState {
  x: number;
  y: number;
  opacity: number;
  dragging: boolean;
  swipedOut: ToastSwipeExit | null;
}

const INITIAL_SWIPE_STATE: SwipeVisualState = {
  x: 0,
  y: 0,
  opacity: 1,
  dragging: false,
  swipedOut: null,
};

function ToastCard({ item, store }: { item: ToastItem; store: ToastStore }) {
  const pointerRef = useRef<PointerDragSession | null>(null);
  const [swipe, setSwipe] = useState<SwipeVisualState>(INITIAL_SWIPE_STATE);
  const hasExtra = Boolean(item.description || item.action);

  const Icon =
    item.tone === "success"
      ? Check
      : item.tone === "error"
        ? AlertTriangle
        : Info;

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (item.leaving || swipe.swipedOut) return;
    if (!event.isPrimary || event.button !== 0) return;
    if ((event.target as HTMLElement | null)?.closest("button, a")) return;

    const width = event.currentTarget.getBoundingClientRect().width || 320;
    pointerRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTime: performance.now(),
      width,
      axis: null,
      captured: false,
    };
    store.pause(item.id);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const active = pointerRef.current;
    if (!active || active.pointerId !== event.pointerId) return;

    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (!active.axis) {
      const nextAxis = resolveToastSwipeAxis(dx, dy);
      if (!nextAxis) return;
      active.axis = nextAxis;
    }

    if (!active.captured) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
        active.captured = true;
      } catch {
        /* Pointer capture may not be supported for synthetic events. */
      }
    }

    const offset = computeToastSwipeOffset(active.axis, dx, dy, active.width);
    setSwipe({
      x: offset.x,
      y: offset.y,
      opacity: offset.opacity,
      dragging: true,
      swipedOut: null,
    });
  }

  function finishPointer(
    event: PointerEvent<HTMLDivElement>,
    cancelled: boolean,
  ) {
    const active = pointerRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    pointerRef.current = null;

    if (active.captured) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* Ignore already-released capture. */
      }
    }

    if (!cancelled && active.axis) {
      const exit = evaluateToastSwipeDismiss({
        axis: active.axis,
        dx: event.clientX - active.startX,
        dy: event.clientY - active.startY,
        elapsedMs: performance.now() - active.startTime,
        width: active.width,
      });
      if (exit) {
        const targetX =
          exit === "left"
            ? -(active.width + 48)
            : exit === "right"
              ? active.width + 48
              : 0;
        const targetY = exit === "up" ? -96 : 0;
        setSwipe({
          x: targetX,
          y: targetY,
          opacity: 0,
          dragging: false,
          swipedOut: exit,
        });
        store.dismiss(item.id);
        return;
      }
    }

    setSwipe(INITIAL_SWIPE_STATE);
    store.resume(item.id);
  }

  const transformStyle =
    swipe.dragging || swipe.swipedOut || swipe.x !== 0 || swipe.y !== 0
      ? {
          transform: `translate3d(${swipe.x}px, ${swipe.y}px, 0)`,
          opacity: swipe.opacity,
        }
      : undefined;

  return (
    <div
      className={styles.toastSlot}
      data-leaving={item.leaving ? "true" : undefined}
      data-swiped-out={swipe.swipedOut ? "true" : undefined}
    >
      <div
        data-tone={item.tone}
        data-multiline={hasExtra ? "true" : undefined}
        data-dragging={swipe.dragging ? "true" : undefined}
        data-swiped-out={swipe.swipedOut ? "true" : undefined}
        role={toastAriaRole(item.tone)}
        aria-live={toastLiveMode(item.tone)}
        aria-atomic="true"
        className={styles.toast}
        style={transformStyle}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishPointer(event, false)}
        onPointerCancel={(event) => finishPointer(event, true)}
        onMouseEnter={() => {
          if (!pointerRef.current) store.pause(item.id);
        }}
        onMouseLeave={() => {
          if (!pointerRef.current) store.resume(item.id);
        }}
        onFocus={() => store.pause(item.id)}
        onBlur={(event) => {
          if (
            !pointerRef.current &&
            !event.currentTarget.contains(event.relatedTarget)
          ) {
            store.resume(item.id);
          }
        }}
      >
        <span className={styles.iconWrap} aria-hidden="true">
          <Icon size={18} strokeWidth={2.4} />
        </span>
        <div className={styles.body}>
          <p className={styles.message}>{item.message}</p>
          {item.description && (
            <p className={styles.description}>{item.description}</p>
          )}
          {item.action && (
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => {
                item.action?.onClick();
                store.dismiss(item.id);
              }}
            >
              {item.action.label}
            </button>
          )}
        </div>
        <button
          type="button"
          className={styles.dismissButton}
          aria-label="Tutup notifikasi"
          onClick={() => store.dismiss(item.id)}
        >
          <X size={16} aria-hidden="true" />
        </button>
        <span className={styles.swipeHandle} aria-hidden="true" />
      </div>
    </div>
  );
}

const ToastContext = createContext<ToastApi>(NOOP_TOAST_API);

/** Global floating toast feedback provider mounted at root layout. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const store = getClientToastStore();
  const toasts = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => EMPTY_TOASTS,
  );

  useEffect(() => {
    restorePersistedToasts(store);
  }, [store]);

  const api = useMemo<ToastApi>(
    () => ({
      success: (message, options) => store.push("success", message, options),
      info: (message, options) => store.push("info", message, options),
      error: (message, options) => store.push("error", message, options),
      dismiss: (id) => store.dismiss(id),
      clear: () => store.clear(),
    }),
    [store],
  );

  return (
    <ToastContext value={api}>
      {children}
      <div
        className={styles.viewport}
        role="region"
        aria-label="Notifikasi"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {toasts.map((item) => (
          <ToastCard
            key={`${item.id}-${item.revision}`}
            item={item}
            store={store}
          />
        ))}
      </div>
    </ToastContext>
  );
}

/** Access app-wide floating toast notifications. Safe no-op if rendered outside ToastProvider. */
export function useToast(): ToastApi {
  return useContext(ToastContext);
}
