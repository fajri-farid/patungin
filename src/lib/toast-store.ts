export type ToastTone = "success" | "info" | "error";

export type ToastSwipeAxis = "x" | "y";
export type ToastSwipeExit = "left" | "right" | "up";

export const TOAST_SWIPE_LOCK_PX = 6;
export const TOAST_SWIPE_HORIZONTAL_MIN_PX = 84;
export const TOAST_SWIPE_HORIZONTAL_RATIO = 0.3;
export const TOAST_SWIPE_UP_MIN_PX = 34;
export const TOAST_SWIPE_FLICK_VX = 0.45;
export const TOAST_SWIPE_FLICK_VY = 0.35;

export function resolveToastSwipeAxis(
  dx: number,
  dy: number,
): ToastSwipeAxis | null {
  if (Math.hypot(dx, dy) < TOAST_SWIPE_LOCK_PX) return null;
  return Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
}

export function computeToastSwipeOffset(
  axis: ToastSwipeAxis,
  dx: number,
  dy: number,
  width: number,
): { x: number; y: number; opacity: number } {
  if (axis === "x") {
    const threshold = Math.max(
      48,
      Math.min(
        TOAST_SWIPE_HORIZONTAL_MIN_PX,
        width * TOAST_SWIPE_HORIZONTAL_RATIO,
      ),
    );
    const progress = Math.min(1, Math.abs(dx) / (threshold * 1.45));
    return {
      x: dx,
      y: 0,
      opacity: Math.max(0.25, 1 - progress * 0.72),
    };
  }
  const y = dy < 0 ? dy : dy * 0.18;
  const progress =
    dy < 0 ? Math.min(1, Math.abs(dy) / (TOAST_SWIPE_UP_MIN_PX * 1.5)) : 0;
  return {
    x: 0,
    y,
    opacity: Math.max(0.25, 1 - progress * 0.72),
  };
}

export function evaluateToastSwipeDismiss(params: {
  axis: ToastSwipeAxis;
  dx: number;
  dy: number;
  elapsedMs: number;
  width: number;
}): ToastSwipeExit | null {
  const { axis, dx, dy, width } = params;
  const elapsed = Math.max(1, params.elapsedMs);
  if (axis === "x") {
    const threshold = Math.max(
      48,
      Math.min(
        TOAST_SWIPE_HORIZONTAL_MIN_PX,
        width * TOAST_SWIPE_HORIZONTAL_RATIO,
      ),
    );
    const vx = dx / elapsed;
    const passedDistance = Math.abs(dx) >= threshold;
    const passedFlick =
      Math.abs(vx) >= TOAST_SWIPE_FLICK_VX && Math.abs(dx) >= 24;
    if (!passedDistance && !passedFlick) return null;
    return dx < 0 ? "left" : "right";
  }
  const vy = dy / elapsed;
  const passedDistance = dy <= -TOAST_SWIPE_UP_MIN_PX;
  const passedFlick = vy <= -TOAST_SWIPE_FLICK_VY && dy <= -14;
  if (!passedDistance && !passedFlick) return null;
  return "up";
}

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  description?: string;
  /** Set to 0 to disable auto-dismiss until manually closed. */
  durationMs?: number;
  action?: ToastAction;
}

export interface ToastItem {
  id: string;
  tone: ToastTone;
  message: string;
  description?: string;
  durationMs: number;
  /** Incremented when an identical active toast is refreshed in place. */
  revision: number;
  leaving: boolean;
  action?: ToastAction;
}

export interface PersistedToast {
  tone: ToastTone;
  message: string;
  description?: string;
  expiresAt: number;
}

export const MAX_VISIBLE_TOASTS = 3;

export const TOAST_EXIT_DURATION_MS = 180;

export const TOAST_DURATION_MS: Record<ToastTone, number> = {
  success: 4000,
  info: 4000,
  error: 5500,
};

const MIN_RESUME_DURATION_MS = 500;
const MIN_RESTORE_REMAINING_MS = 350;
const MAX_RESTORE_REMAINING_MS = 10_000;

export function toastAriaRole(tone: ToastTone): "alert" | "status" {
  return tone === "error" ? "alert" : "status";
}

export function toastLiveMode(tone: ToastTone): "assertive" | "polite" {
  return tone === "error" ? "assertive" : "polite";
}

/** Normalizes and trims entity labels (bill title, item, participant) so toasts stay compact. */
export function formatToastName(
  value: string | null | undefined,
  maxLength = 32,
): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

interface TimerState {
  timerId: ReturnType<typeof setTimeout> | null;
  remainingMs: number;
  startedAt: number;
  paused: boolean;
}

export interface ToastStore {
  push: (tone: ToastTone, message: string, options?: ToastOptions) => string;
  dismiss: (id: string) => void;
  pause: (id: string) => void;
  resume: (id: string) => void;
  clear: () => void;
  getPersistable: () => PersistedToast[];
  restorePersisted: (entries: readonly PersistedToast[]) => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => readonly ToastItem[];
}

export function createToastStore(config?: {
  maxVisible?: number;
  exitDurationMs?: number;
  now?: () => number;
}): ToastStore {
  const maxVisible = Math.max(1, config?.maxVisible ?? MAX_VISIBLE_TOASTS);
  const exitDurationMs = Math.max(0, config?.exitDurationMs ?? 0);
  const now = config?.now ?? (() => Date.now());
  const listeners = new Set<() => void>();
  const timers = new Map<string, TimerState>();
  const exitTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let items: readonly ToastItem[] = [];
  let sequence = 0;

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const clearAutoTimer = (id: string) => {
    const entry = timers.get(id);
    if (!entry) return;
    if (entry.timerId !== null) {
      globalThis.clearTimeout(entry.timerId);
    }
    timers.delete(id);
  };

  const clearExitTimer = (id: string) => {
    const timerId = exitTimers.get(id);
    if (timerId !== undefined) {
      globalThis.clearTimeout(timerId);
      exitTimers.delete(id);
    }
  };

  const removeNow = (id: string) => {
    clearAutoTimer(id);
    clearExitTimer(id);
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length) return;
    items = next;
    notify();
  };

  const dismiss = (id: string) => {
    clearAutoTimer(id);
    const existing = items.find((item) => item.id === id);
    if (!existing) return;

    if (exitDurationMs > 0 && !existing.leaving) {
      items = items.map((item) =>
        item.id === id ? { ...item, leaving: true } : item,
      );
      notify();
      clearExitTimer(id);
      const timerId = globalThis.setTimeout(() => {
        removeNow(id);
      }, exitDurationMs);
      exitTimers.set(id, timerId);
      return;
    }

    removeNow(id);
  };

  const scheduleTimer = (id: string, durationMs: number) => {
    clearAutoTimer(id);
    if (durationMs <= 0) return;
    const timerId = globalThis.setTimeout(() => {
      dismiss(id);
    }, durationMs);
    timers.set(id, {
      timerId,
      remainingMs: durationMs,
      startedAt: now(),
      paused: false,
    });
  };

  const push = (
    tone: ToastTone,
    rawMessage: string,
    options?: ToastOptions,
  ): string => {
    const message = rawMessage.trim();
    if (!message) return "";

    const durationMs =
      options?.durationMs !== undefined
        ? Math.max(0, options.durationMs)
        : TOAST_DURATION_MS[tone];
    const description = options?.description?.trim() || undefined;

    // Coalesce identical active toasts so rapid taps refresh instead of stacking duplicates.
    const duplicate = items.find(
      (item) =>
        !item.leaving &&
        item.tone === tone &&
        item.message === message &&
        item.description === description,
    );
    if (duplicate) {
      const refreshed: ToastItem = {
        ...duplicate,
        durationMs,
        revision: duplicate.revision + 1,
        action: options?.action,
      };
      items = [refreshed, ...items.filter((item) => item.id !== duplicate.id)];
      scheduleTimer(duplicate.id, durationMs);
      notify();
      return duplicate.id;
    }

    sequence += 1;
    const id = `toast_${sequence}`;
    const item: ToastItem = {
      id,
      tone,
      message,
      description,
      durationMs,
      revision: 1,
      leaving: false,
      action: options?.action,
    };

    const nextItems = [item, ...items];
    const activeItems = nextItems.filter((entry) => !entry.leaving);
    if (activeItems.length > maxVisible) {
      const evictedIds = new Set(
        activeItems.slice(maxVisible).map((entry) => entry.id),
      );
      for (const oldId of evictedIds) {
        clearAutoTimer(oldId);
        clearExitTimer(oldId);
      }
      items = nextItems.filter((entry) => !evictedIds.has(entry.id));
    } else {
      items = nextItems;
    }

    scheduleTimer(id, durationMs);
    notify();
    return id;
  };

  const pause = (id: string) => {
    const entry = timers.get(id);
    if (!entry || entry.paused) return;
    const item = items.find((candidate) => candidate.id === id);
    if (!item || item.leaving) return;
    if (entry.timerId !== null) {
      globalThis.clearTimeout(entry.timerId);
    }
    const elapsed = Math.max(0, now() - entry.startedAt);
    timers.set(id, {
      timerId: null,
      remainingMs: Math.max(MIN_RESUME_DURATION_MS, entry.remainingMs - elapsed),
      startedAt: now(),
      paused: true,
    });
  };

  const resume = (id: string) => {
    const entry = timers.get(id);
    if (!entry || !entry.paused) return;
    const item = items.find((candidate) => candidate.id === id);
    if (!item || item.leaving) {
      timers.delete(id);
      return;
    }
    scheduleTimer(id, entry.remainingMs);
  };

  const clear = () => {
    for (const id of Array.from(timers.keys())) {
      clearAutoTimer(id);
    }
    for (const id of Array.from(exitTimers.keys())) {
      clearExitTimer(id);
    }
    if (items.length === 0) return;
    items = [];
    notify();
  };

  const getPersistable = (): PersistedToast[] => {
    const currentNow = now();
    const persisted: PersistedToast[] = [];
    for (const item of items) {
      if (item.leaving || item.durationMs <= 0 || item.action) continue;
      const timer = timers.get(item.id);
      if (!timer) continue;
      const remainingMs = timer.paused
        ? timer.remainingMs
        : timer.remainingMs - Math.max(0, currentNow - timer.startedAt);
      if (remainingMs <= MIN_RESTORE_REMAINING_MS) continue;
      persisted.push({
        tone: item.tone,
        message: item.message,
        description: item.description,
        expiresAt: currentNow + Math.min(remainingMs, MAX_RESTORE_REMAINING_MS),
      });
    }
    return persisted;
  };

  const restorePersisted = (entries: readonly PersistedToast[]) => {
    const currentNow = now();
    // Push oldest-first so newest ends up on top after prepend.
    const valid = entries
      .filter(
        (entry) =>
          (entry.tone === "success" ||
            entry.tone === "info" ||
            entry.tone === "error") &&
          typeof entry.message === "string" &&
          entry.message.trim().length > 0 &&
          typeof entry.expiresAt === "number" &&
          entry.expiresAt - currentNow > MIN_RESTORE_REMAINING_MS &&
          entry.expiresAt - currentNow <= MAX_RESTORE_REMAINING_MS,
      )
      .slice(0, maxVisible)
      .reverse();

    for (const entry of valid) {
      push(entry.tone, entry.message, {
        description: entry.description,
        durationMs: Math.round(entry.expiresAt - currentNow),
      });
    }
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const getSnapshot = () => items;

  return {
    push,
    dismiss,
    pause,
    resume,
    clear,
    getPersistable,
    restorePersisted,
    subscribe,
    getSnapshot,
  };
}
