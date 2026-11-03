import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { readDevDb, writeDevDb } from "@/server/store/dev-database";

describe("sandbox changes across server module graphs", () => {
  it("refreshes a cached graph when another route updates the data file", () => {
    const first = readDevDb();
    writeDevDb(first);
    const external = structuredClone(first);
    external.operationalEvents.test = { id: "test", ownerUid: "local", code: "MISSING_FILE", flag: "INPUT_REJECTED", level: "normal", stage: "validation", firstAt: "2026-11-03T04:00:00Z", lastAt: "2026-11-03T04:00:00Z", count: 1, requestId: "test", billId: null, attemptId: null, providerCalled: false, quotaReserved: false, deleteAfter: new Date() };
    fs.writeFileSync(process.env.PATUNGIN_DEV_DATA_PATH!, JSON.stringify(external));
    expect(readDevDb().operationalEvents.test.code).toBe("MISSING_FILE");
    expect(readDevDb()).not.toBe(first);
  });
});
