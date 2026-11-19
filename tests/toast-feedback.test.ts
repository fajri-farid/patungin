import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeToastSwipeOffset,
  createToastStore,
  evaluateToastSwipeDismiss,
  formatToastName,
  MAX_VISIBLE_TOASTS,
  resolveToastSwipeAxis,
  TOAST_DURATION_MS,
  TOAST_EXIT_DURATION_MS,
  toastAriaRole,
  toastLiveMode,
} from "../src/lib/toast-store";

afterEach(() => {
  vi.useRealTimers();
});

describe("toast store", () => {
  it("prepends toasts newest-first with default durations and auto-dismisses", () => {
    vi.useFakeTimers();
    const store = createToastStore();
    const listener = vi.fn();
    store.subscribe(listener);

    const firstId = store.push("success", "Tagihan dihapus.");
    const secondId = store.push("error", "Pesan belum bisa disalin.");

    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();
    expect(store.getSnapshot().map((item) => item.id)).toEqual([
      secondId,
      firstId,
    ]);
    expect(store.getSnapshot()[0]?.durationMs).toBe(TOAST_DURATION_MS.error);
    expect(store.getSnapshot()[1]?.durationMs).toBe(TOAST_DURATION_MS.success);

    vi.advanceTimersByTime(TOAST_DURATION_MS.success);
    expect(store.getSnapshot().map((item) => item.id)).toEqual([secondId]);

    vi.advanceTimersByTime(TOAST_DURATION_MS.error - TOAST_DURATION_MS.success);
    expect(store.getSnapshot()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("ignores blank messages without notifying subscribers", () => {
    const store = createToastStore();
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.push("info", "   ")).toBe("");
    expect(store.getSnapshot()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("coalesces identical active toasts by refreshing revision and timer", () => {
    vi.useFakeTimers();
    const store = createToastStore();

    const firstId = store.push("success", "Pesan ringkasan disalin.", {
      durationMs: 2000,
    });
    vi.advanceTimersByTime(1500);

    const secondId = store.push("success", "Pesan ringkasan disalin.", {
      durationMs: 2000,
    });

    expect(secondId).toBe(firstId);
    expect(store.getSnapshot()).toHaveLength(1);
    expect(store.getSnapshot()[0]?.revision).toBe(2);

    // Original timer would have fired at 2000ms; refreshed timer lasts until 3500ms.
    vi.advanceTimersByTime(1999);
    expect(store.getSnapshot()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot()).toEqual([]);
  });

  it("marks toasts leaving before removal when exitDurationMs is configured", () => {
    vi.useFakeTimers();
    const store = createToastStore({ exitDurationMs: TOAST_EXIT_DURATION_MS });

    const id = store.push("success", "Foto struk dihapus.", {
      durationMs: 1000,
    });
    expect(store.getSnapshot()[0]?.leaving).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(store.getSnapshot()).toHaveLength(1);
    expect(store.getSnapshot()[0]?.id).toBe(id);
    expect(store.getSnapshot()[0]?.leaving).toBe(true);

    vi.advanceTimersByTime(TOAST_EXIT_DURATION_MS);
    expect(store.getSnapshot()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("caps visible toasts to MAX_VISIBLE_TOASTS and cleans up evicted timers", () => {
    vi.useFakeTimers();
    const store = createToastStore();

    const ids = [
      store.push("info", "Satu"),
      store.push("info", "Dua"),
      store.push("info", "Tiga"),
      store.push("success", "Empat"),
    ];

    expect(MAX_VISIBLE_TOASTS).toBe(3);
    expect(store.getSnapshot().map((item) => item.id)).toEqual([
      ids[3],
      ids[2],
      ids[1],
    ]);
    expect(vi.getTimerCount()).toBe(3);

    store.clear();
    expect(store.getSnapshot()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pauses and resumes remaining auto-dismiss time on hover or focus", () => {
    vi.useFakeTimers();
    let clock = 1000;
    const store = createToastStore({ now: () => clock });

    const id = store.push("success", "Foto struk dihapus.", {
      durationMs: 2000,
    });

    clock += 1200;
    vi.advanceTimersByTime(1200);
    store.pause(id);

    // Pausing keeps the toast alive even past the original deadline.
    clock += 5000;
    vi.advanceTimersByTime(5000);
    expect(store.getSnapshot()).toHaveLength(1);

    // Resuming finishes after the remaining 800ms.
    store.resume(id);
    clock += 799;
    vi.advanceTimersByTime(799);
    expect(store.getSnapshot()).toHaveLength(1);

    clock += 1;
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot()).toEqual([]);
  });

  it("supports sticky toasts (durationMs: 0) and manual dismiss", () => {
    vi.useFakeTimers();
    const store = createToastStore();
    const listener = vi.fn();
    store.subscribe(listener);

    const id = store.push("info", "Tetap tampil.", { durationMs: 0 });
    vi.advanceTimersByTime(60_000);
    expect(store.getSnapshot()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);

    store.dismiss("missing_id");
    expect(listener).toHaveBeenCalledTimes(1);

    store.dismiss(id);
    expect(store.getSnapshot()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("persists active timed toasts and restores unexpired entries across reloads", () => {
    vi.useFakeTimers();
    let clock = 10_000;
    const firstStore = createToastStore({ now: () => clock });

    firstStore.push("success", 'Tagihan "Makan siang" dihapus.', {
      durationMs: 4000,
    });
    firstStore.push("info", "Link tagihan dimatikan.", {
      durationMs: 4000,
    });

    clock += 1000;
    vi.advanceTimersByTime(1000);
    const snapshot = firstStore.getPersistable();
    expect(snapshot).toHaveLength(2);
    firstStore.clear();

    // Simulate reload 200ms later: both toasts restore with ~2800ms remaining, newest on top.
    clock += 200;
    const secondStore = createToastStore({ now: () => clock });
    secondStore.restorePersisted([
      ...snapshot,
      {
        tone: "success",
        message: "Sudah kadaluarsa",
        expiresAt: clock - 10,
      },
    ]);

    expect(secondStore.getSnapshot().map((item) => item.message)).toEqual([
      "Link tagihan dimatikan.",
      'Tagihan "Makan siang" dihapus.',
    ]);
    expect(secondStore.getSnapshot()[0]?.durationMs).toBe(2800);

    vi.advanceTimersByTime(2800);
    expect(secondStore.getSnapshot()).toEqual([]);
  });
});

describe("toast accessibility and formatting helpers", () => {
  it("maps ARIA roles and live modes per semantic tone", () => {
    expect(toastAriaRole("success")).toBe("status");
    expect(toastLiveMode("success")).toBe("polite");
    expect(toastAriaRole("info")).toBe("status");
    expect(toastLiveMode("info")).toBe("polite");
    expect(toastAriaRole("error")).toBe("alert");
    expect(toastLiveMode("error")).toBe("assertive");
  });

  it("normalizes whitespace and truncates long entity names cleanly", () => {
    expect(formatToastName("   ")).toBe("");
    expect(formatToastName(null)).toBe("");
    expect(formatToastName("  Makan   Malam  ")).toBe("Makan Malam");
    expect(
      formatToastName("Makan Malam Bareng Tim Produk Divisi Jakarta", 20),
    ).toBe("Makan Malam Bareng…");
  });
});

describe("toast swipe-to-dismiss gesture helpers", () => {
  it("locks axis only after crossing the dead-zone threshold", () => {
    expect(resolveToastSwipeAxis(2, 3)).toBeNull();
    expect(resolveToastSwipeAxis(12, 4)).toBe("x");
    expect(resolveToastSwipeAxis(-4, -10)).toBe("y");
  });

  it("fades opacity on swipe and applies rubber-band resistance on downward pull", () => {
    const right = computeToastSwipeOffset("x", 80, 0, 360);
    expect(right.x).toBe(80);
    expect(right.y).toBe(0);
    expect(right.opacity).toBeLessThan(1);

    const up = computeToastSwipeOffset("y", 0, -30, 360);
    expect(up.y).toBe(-30);
    expect(up.opacity).toBeLessThan(1);

    const down = computeToastSwipeOffset("y", 0, 50, 360);
    expect(down.y).toBeCloseTo(9);
    expect(down.opacity).toBe(1);
  });

  it("dismisses on horizontal distance, horizontal flick, or upward swipe and springs back on small nudges", () => {
    expect(
      evaluateToastSwipeDismiss({
        axis: "x",
        dx: 92,
        dy: 0,
        elapsedMs: 400,
        width: 360,
      }),
    ).toBe("right");

    expect(
      evaluateToastSwipeDismiss({
        axis: "x",
        dx: -36,
        dy: 0,
        elapsedMs: 50,
        width: 360,
      }),
    ).toBe("left");

    expect(
      evaluateToastSwipeDismiss({
        axis: "y",
        dx: 0,
        dy: -40,
        elapsedMs: 250,
        width: 360,
      }),
    ).toBe("up");

    expect(
      evaluateToastSwipeDismiss({
        axis: "x",
        dx: 22,
        dy: 0,
        elapsedMs: 200,
        width: 360,
      }),
    ).toBeNull();

    expect(
      evaluateToastSwipeDismiss({
        axis: "y",
        dx: 0,
        dy: 40,
        elapsedMs: 120,
        width: 360,
      }),
    ).toBeNull();
  });
});
