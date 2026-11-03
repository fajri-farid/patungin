import fs from "node:fs";
import { parseEnv } from "node:util";
import { expect, it } from "vitest";

it("preserves admin, invitation secret, and quota values filled into the environment template", () => {
  const template = fs.readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  const filled = template
    .replace(/^ADMIN_EMAILS=.*$/m, "ADMIN_EMAILS=admin@example.com")
    .replace(/^INVITE_SIGNING_SECRET=.*$/m, "INVITE_SIGNING_SECRET=test-only-invite-secret-at-least-32-characters")
    .replace(/^SCAN_MONTHLY_LIMIT=.*$/m, "SCAN_MONTHLY_LIMIT=42");

  expect(parseEnv(filled)).toMatchObject({
    ADMIN_EMAILS: "admin@example.com",
    INVITE_SIGNING_SECRET: "test-only-invite-secret-at-least-32-characters",
    SCAN_MONTHLY_LIMIT: "42",
  });
});
