import { afterEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  type Bill = {
    id: string;
    ownerUid: string;
    status: string;
    updatedAt: string;
  };
  const state: {
    bills: Bill[];
    requests: { limit: number; filters: string[]; orders: string[] }[];
  } = { bills: [], requests: [] };
  const compare = (a: Bill, b: { updatedAt: string; id: string }) =>
    a.updatedAt === b.updatedAt
      ? a.id === b.id
        ? 0
        : a.id > b.id
          ? -1
          : 1
      : a.updatedAt > b.updatedAt
        ? -1
        : 1;
  const firestore = {
    collection: (name: string) => {
      if (name !== "bills") throw new Error("unexpected collection");
      const filters: { field: string; value: string }[] = [];
      const orders: string[] = [];
      let cursor:
        { updatedAt: string; id: string; before: boolean } | undefined;
      let maximum = 0;
      let last = false;
      const query = {
        where: (field: string, operation: string, value: string) => {
          if (operation !== "==") throw new Error("unexpected filter");
          filters.push({ field, value });
          return query;
        },
        orderBy: (field: unknown, direction: string) => {
          orders.push(
            `${typeof field === "string" ? field : "__name__"}:${direction}`,
          );
          return query;
        },
        startAfter: (updatedAt: string, id: string) => {
          cursor = { updatedAt, id, before: false };
          return query;
        },
        endBefore: (updatedAt: string, id: string) => {
          cursor = { updatedAt, id, before: true };
          return query;
        },
        limit: (count: number) => {
          maximum = count;
          return query;
        },
        limitToLast: (count: number) => {
          maximum = count;
          last = true;
          return query;
        },
        get: async () => {
          state.requests.push({
            limit: maximum,
            filters: filters.map((f) => f.field),
            orders,
          });
          let matches = state.bills
            .filter((bill) =>
              filters.every(
                (filter) => bill[filter.field as keyof Bill] === filter.value,
              ),
            )
            .sort(compare);
          if (cursor)
            matches = matches.filter((bill) =>
              cursor!.before
                ? compare(bill, cursor!) < 0
                : compare(bill, cursor!) > 0,
            );
          matches = last ? matches.slice(-maximum) : matches.slice(0, maximum);
          return {
            empty: matches.length === 0,
            docs: matches.map((bill) => ({ id: bill.id, data: () => bill })),
          };
        },
      };
      return query;
    },
  };
  return { state, firestore };
});
vi.mock("../src/server/firebase/admin", () => ({
  getAdminFirestore: () => fake.firestore,
}));

import {
  decodeBillCursor,
  encodeBillCursor,
} from "../src/server/store/bill-pagination";
import {
  createDraftBill,
  getLatestDraftByOwner,
  listBillsByOwner,
} from "../src/server/store/repository";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("Pagination tagihan", () => {
  it("navigates both ways through matching timestamps without leaking another owner's bills", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T10:00:00.000Z"));
    const owner = "pagination-owner";
    for (let i = 0; i < 23; i++)
      await createDraftBill({
        ownerUid: owner,
        ownerVerifiedEmail: "host@patungin.local",
      });
    await createDraftBill({
      ownerUid: "another-owner",
      ownerVerifiedEmail: "host@patungin.local",
    });
    const first = await listBillsByOwner(owner, { pageSize: 10 });
    const second = await listBillsByOwner(owner, {
      pageSize: 10,
      after: first.nextCursor!,
    });
    const third = await listBillsByOwner(owner, {
      pageSize: 10,
      after: second.nextCursor!,
    });
    expect([
      first.bills.length,
      second.bills.length,
      third.bills.length,
    ]).toEqual([10, 10, 3]);
    expect(
      new Set(
        [...first.bills, ...second.bills, ...third.bills].map(
          (bill) => bill.id,
        ),
      ).size,
    ).toBe(23);
    expect(third.nextCursor).toBeNull();
    const back = await listBillsByOwner(owner, {
      pageSize: 10,
      before: third.previousCursor!,
    });
    expect(back.bills.map((bill) => bill.id)).toEqual(
      second.bills.map((bill) => bill.id),
    );
    expect(
      (
        await listBillsByOwner(owner, {
          pageSize: 10,
          before: back.previousCursor!,
        })
      ).bills.map((bill) => bill.id),
    ).toEqual(first.bills.map((bill) => bill.id));
  });

  it("rejects malformed cursors and unreasonable page sizes", async () => {
    expect(decodeBillCursor("not-valid")).toBeNull();
    expect(
      decodeBillCursor(
        encodeBillCursor({ updatedAt: "2026-13-01T10:00:00.000Z", id: "x" }),
      ),
    ).toBeNull();
    expect(
      decodeBillCursor(
        encodeBillCursor({
          updatedAt: "2026-11-01T10:00:00.000Z",
          id: "../other",
        }),
      ),
    ).toBeNull();
    await expect(
      listBillsByOwner("owner", { pageSize: 51 }),
    ).rejects.toMatchObject({ code: "INVALID_PAGE" });
    await expect(
      listBillsByOwner("owner", { pageSize: 10, after: "bad" }),
    ).rejects.toMatchObject({ code: "INVALID_PAGE" });
  });

  it("uses owner-scoped Firestore cursors and bounded queries, including the latest draft", async () => {
    vi.stubEnv("FIREBASE_PROJECT_ID", "test-project");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "test-project");
    vi.stubEnv(
      "FIREBASE_CLIENT_EMAIL",
      "admin@test-project.iam.gserviceaccount.com",
    );
    vi.stubEnv("FIREBASE_PRIVATE_KEY", "fake-key");
    fake.state.requests = [];
    fake.state.bills = Array.from({ length: 24 }, (_, i) => ({
      id: `bill_${String(i).padStart(3, "0")}`,
      ownerUid: i === 23 ? "other" : "owner",
      status: i === 0 ? "draft" : "finalized",
      updatedAt: "2026-11-01T10:00:00.000Z",
    }));
    const first = await listBillsByOwner("owner", { pageSize: 10 });
    const second = await listBillsByOwner("owner", {
      pageSize: 10,
      after: first.nextCursor!,
    });
    const third = await listBillsByOwner("owner", {
      pageSize: 10,
      after: second.nextCursor!,
    });
    const back = await listBillsByOwner("owner", {
      pageSize: 10,
      before: third.previousCursor!,
    });
    expect(back.bills.map((bill) => bill.id)).toEqual(
      second.bills.map((bill) => bill.id),
    );
    expect(
      new Set(
        [...first.bills, ...second.bills, ...third.bills].map(
          (bill) => bill.id,
        ),
      ).size,
    ).toBe(23);
    expect((await getLatestDraftByOwner("owner"))?.id).toBe("bill_000");
    expect(fake.state.requests.slice(0, 4)).toEqual(
      Array.from({ length: 4 }, () => ({
        limit: 11,
        filters: ["ownerUid"],
        orders: ["updatedAt:desc", "__name__:desc"],
      })),
    );
    expect(fake.state.requests[4]).toEqual({
      limit: 1,
      filters: ["ownerUid", "status"],
      orders: ["updatedAt:desc"],
    });
  });
});
