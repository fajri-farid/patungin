import { afterEach, expect, it, vi } from "vitest";
const context = vi.hoisted(() => ({
  origin: "http://localhost:3000",
  cookie: "",
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ origin: context.origin }),
  cookies: async () => ({
    get: () => (context.cookie ? { value: context.cookie } : undefined),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import {
  paymentTrackingAction,
  refreshPublicShareAction,
} from "../src/app/actions/bills";
afterEach(() => {
  context.origin = "http://localhost:3000";
  context.cookie = "";
});
it("requires authentication for payment writes and rejects cross-origin writes", async () => {
  const request = {
    billId: "bill",
    expectedRevision: 1,
    finalizationId: "fin",
  };
  expect((await paymentTrackingAction(request)).ok).toBe(false);
  context.origin = "https://attacker.example";
  expect(await paymentTrackingAction(request)).toMatchObject({
    ok: false,
    code: "ORIGIN_MISMATCH",
  });
});
it("rejects invalid or oversized public tokens without granting write access", async () => {
  expect(await refreshPublicShareAction("invalid")).toMatchObject({
    ok: false,
    code: "LINK_UNAVAILABLE",
  });
  expect(await refreshPublicShareAction("x".repeat(300))).toMatchObject({
    ok: false,
    code: "LINK_UNAVAILABLE",
  });
});
