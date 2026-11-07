import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, vi } from "vitest";

// Next enforces this build-time boundary; Node unit tests run server modules directly.
vi.mock("server-only", () => ({}));

// Tests must never use a developer's live Firebase/Gemini credentials or local
// sandbox database. Each test worker gets one disposable database file.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "patungin-tests-"));
const databasePath = path.join(directory, "database.json");
Object.assign(process.env, {
  FIREBASE_PROJECT_ID: "",
  FIREBASE_CLIENT_EMAIL: "",
  FIREBASE_PRIVATE_KEY: "",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "",
  NEXT_PUBLIC_FIREBASE_API_KEY: "",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "",
  ADMIN_EMAILS: "",
  ADMIN_UIDS: "",
  SCAN_MONTHLY_LIMIT: "30",
  ALLOWED_EMAILS: "host@patungin.local",
  APP_ORIGIN: "http://localhost:3000",
  GEMINI_API_KEY: "",
  GEMINI_MODEL: "",
  GEMINI_SCAN_ENABLED: "false",
  SHARE_LINKS_ENABLED: "true",
  SHARE_SIGNING_SECRET: "test-only-signing-secret-that-is-not-used-in-production",
  INVITE_SIGNING_SECRET: "test-only-invite-secret-that-is-not-used-in-production",
  PATUNGIN_DEV_SANDBOX: "true",
  PATUNGIN_DEV_DATA_PATH: databasePath,
});

afterAll(() => {
  if (fs.existsSync(databasePath)) fs.unlinkSync(databasePath);
  fs.rmdirSync(directory);
});
