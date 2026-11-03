import fs from "node:fs";
import path from "node:path";
import type {
  BillDocument,
  FinalizationSnapshot,
} from "@/domain/billing/types";
import type {
  ShareRecord,
  ScanAttemptRecord,
  UsageBucketRecord,
} from "./repository";
import type { UserAccount, InviteRecord } from "../access/types";
import type { AccountAudit, UserMonthSummary } from "../admin/summary";
import type { OperationalEvent } from "../observability/events";

export interface DevDatabaseSchema {
  bills: Record<string, BillDocument>;
  finalizations: Record<string, FinalizationSnapshot>;
  shares: Record<string, ShareRecord>;
  scanAttempts: Record<string, ScanAttemptRecord>;
  usageDays: Record<string, UsageBucketRecord>;
  usageMonths: Record<string, UsageBucketRecord>;
  users: Record<string, UserAccount>;
  invites: Record<string, InviteRecord>;
  adminUserMonths: Record<string, UserMonthSummary>;
  accountAudits: Record<string, AccountAudit>;
  operationalEvents: Record<string, OperationalEvent>;
}

const DEV_DB_PATH = process.env.PATUNGIN_DEV_DATA_PATH
  ? path.resolve(process.env.PATUNGIN_DEV_DATA_PATH)
  : path.join(process.cwd(), ".patungin-dev-data.json");

let memoryDevDb: DevDatabaseSchema | null = null;
let fileSignature = "";
function currentFileSignature() {
  try {
    const stat = fs.statSync(DEV_DB_PATH, { bigint: true });
    return `${stat.mtimeNs}:${stat.size}`;
  } catch {
    return "";
  }
}

function createEmptyDevDatabase(): DevDatabaseSchema {
  return {
    bills: {},
    finalizations: {},
    shares: {},
    scanAttempts: {},
    usageDays: {},
    usageMonths: {},
    users: {},
    invites: {},
    adminUserMonths: {},
    accountAudits: {},
    operationalEvents: {},
  };
}

export function readDevDb(): DevDatabaseSchema {
  // Next dev can load route handlers and server actions in separate module
  // graphs. Refresh their sandbox snapshots after another graph writes the file.
  const signature = currentFileSignature();
  if (memoryDevDb && signature === fileSignature) return memoryDevDb;
  try {
    if (fs.existsSync(DEV_DB_PATH)) {
      const raw = fs.readFileSync(DEV_DB_PATH, "utf8");
      memoryDevDb = {
        ...createEmptyDevDatabase(),
        ...JSON.parse(raw),
      } as DevDatabaseSchema;
      fileSignature = signature;
      return memoryDevDb;
    }
  } catch {
    // Jika file korup, buat ulang dari seed
  }
  memoryDevDb = createEmptyDevDatabase();
  writeDevDb(memoryDevDb);
  return memoryDevDb;
}

export function writeDevDb(db: DevDatabaseSchema): void {
  memoryDevDb = db;
  try {
    fs.writeFileSync(DEV_DB_PATH, JSON.stringify(db, null, 2), "utf8");
    fileSignature = currentFileSignature();
  } catch {
    throw new Error("Database sandbox tidak dapat disimpan.");
  }
}
