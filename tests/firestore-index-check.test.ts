import { describe, expect, it } from "vitest";
import { checkFirestoreQueryIndexes } from "../scripts/check-firestore-indexes.mjs";

function fakeFirestore(errors: unknown[] = []) {
  const calls: string[][] = [];
  return {
    calls,
    collection(name: string) {
      const trace = [`collection:${name}`];
      const index = calls.push(trace) - 1;
      const query = {
        where(field: string, op: string, value: string) { trace.push(`where:${field}:${op}:${value}`); return query; },
        orderBy(field: unknown, direction: string) { trace.push(`order:${typeof field === "string" ? field : "__name__"}:${direction}`); return query; },
        limit(count: number) { trace.push(`limit:${count}`); return query; },
        async get() { if (errors[index]) throw errors[index]; return { docs: [] }; },
      };
      return query;
    },
  };
}

describe("Read-only Firestore index checks", () => {
  it("checks both application query shapes with a bounded synthetic owner", async () => {
    const firestore = fakeFirestore();
    const result = await checkFirestoreQueryIndexes(firestore, "probe-owner");
    expect(result).toEqual([{ label: "Riwayat tagihan", status: "ready" }, { label: "Draft terakhir", status: "ready" }]);
    expect(firestore.calls).toEqual([
      ["collection:bills", "where:ownerUid:==:probe-owner", "order:updatedAt:desc", "order:__name__:desc", "limit:1"],
      ["collection:bills", "where:ownerUid:==:probe-owner", "where:status:==:draft", "order:updatedAt:desc", "limit:1"],
    ]);
  });

  it("distinguishes missing indexes from permission or connection errors without exposing raw errors", async () => {
    const firestore = fakeFirestore([
      { code: 9, details: "The query requires an index: secret-url" },
      { code: 7, details: "private details" },
    ]);
    const result = await checkFirestoreQueryIndexes(firestore, "probe-owner");
    expect(result).toEqual([{ label: "Riwayat tagihan", status: "missing" }, { label: "Draft terakhir", status: "unavailable" }]);
    expect(JSON.stringify(result)).not.toMatch(/secret|private/);
  });
});
