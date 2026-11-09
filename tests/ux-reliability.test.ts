import { afterEach, describe, expect, it, vi } from "vitest";
import { saveUntilCurrent } from "../src/lib/save-until-current";
import { requestJson, RequestInterruptedError } from "../src/lib/request-json";
import { paymentEditorChanged } from "../src/lib/payment-editor";
import { summarizeBill } from "../src/domain/billing/summary";
import type { BillDocument } from "../src/domain/billing/types";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("save before navigation", () => {
  it("drains edits made during a request using the newly accepted revision", async () => {
    let sequence = 1;
    let revision = 1;
    let text = "first";
    const commits: Array<{ text: string; revision: number }> = [];
    const accept = vi.fn((saved: { revision: number }, current: boolean) => { revision = saved.revision; return current; });
    const result = await saveUntilCurrent({
      sequence: () => sequence,
      save: async () => {
        const snapshot = { text, revision: revision + 1 };
        commits.push(snapshot);
        if (sequence === 1) { text = "newer edit"; sequence++; }
        return snapshot;
      },
      accept,
    });
    expect(commits).toEqual([{ text: "first", revision: 2 }, { text: "newer edit", revision: 3 }]);
    expect(accept.mock.calls.map((call) => call[1])).toEqual([false, true]);
    expect(result).toEqual({ text: "newer edit", revision: 3 });
  });

  it("does not report success when saving the newer edit fails", async () => {
    let sequence = 1;
    const save = vi.fn(async () => { sequence++; return save.mock.calls.length === 1 ? "older" : null; });
    expect(await saveUntilCurrent({ sequence: () => sequence, save, accept: () => {} })).toBeNull();
    expect(save).toHaveBeenCalledTimes(2);
  });
});

describe("request recovery", () => {
  it.each(["<html>Gateway timeout</html>", "", '{"unexpected":true}'])("hides malformed responses: %s", async (body) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 502 })));
    await expect(requestJson("/api/example")).rejects.toThrow(RequestInterruptedError);
    await expect(requestJson("/api/example")).rejects.not.toThrow(/JSON|Unexpected token/);
  });

  it("preserves structured application errors for upload reconciliation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, code: "UPLOAD_RETRY_REQUIRED", error: "Coba lagi." }, { status: 409 })));
    const { response, result } = await requestJson("/api/example");
    expect(response.status).toBe(409);
    expect(result.code).toBe("UPLOAD_RETRY_REQUIRED");
  });

  it("aborts a stalled request once without retrying a mutation", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    vi.stubGlobal("fetch", fetchMock);
    const request = requestJson("/api/example", { method: "POST" }, 100);
    const assertion = expect(request).rejects.toThrow("server mungkin masih berjalan");
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("also bounds a stalled response body", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => ({
      json: () => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("body aborted")))),
    })));
    const assertion = expect(requestJson("/api/example", {}, 100)).rejects.toThrow(RequestInterruptedError);
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
  });
});

it("only warns about real payment edits, including a newly uploaded QRIS", () => {
  const editor = { id: "one", label: "", payment: { method: "bank" as const } };
  expect(paymentEditorChanged(editor)).toBe(false);
  expect(paymentEditorChanged({ ...editor, label: "Bank saya" })).toBe(true);
  expect(paymentEditorChanged({ ...editor, payment: { method: "qris", qrisImageId: "new" } })).toBe(true);
  expect(paymentEditorChanged(editor, editor)).toBe(false);
});

it("dashboard summaries omit payment details and large item/allocation payloads", () => {
  const bill = {
    id: "one", title: "Makan", merchant: "Cafe", status: "draft",
    confirmedGrandTotal: 100000, confirmedInputHash: null,
    items: Array.from({ length: 100 }, () => ({ name: "Pesanan dengan catatan panjang" })),
    participants: [{ name: "A" }, { name: "B" }],
    paymentMethods: [{ accountNumber: "123456789" }], allocations: [{ private: true }],
  } as unknown as BillDocument;
  const summary = summarizeBill(bill);
  expect(summary.itemCount).toBe(100);
  expect(summary.participantCount).toBe(2);
  expect(summary).not.toHaveProperty("items");
  expect(summary).not.toHaveProperty("paymentMethods");
  expect(summary).not.toHaveProperty("allocations");
  expect(JSON.stringify(summary).length).toBeLessThan(JSON.stringify(bill).length / 2);
});
