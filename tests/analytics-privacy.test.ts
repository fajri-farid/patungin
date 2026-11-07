import { describe, expect, it } from "vitest";
import { sanitizeAnalyticsUrl } from "../src/lib/analytics-privacy";
describe("analytics must not receive share tokens or payment URL parameters", () => {
  it("redacts bearer share tokens, query parameters and fragments", () => {
    const safe = sanitizeAnalyticsUrl(
      "https://patungin.example/s/v2.private-token?accountNumber=123#secret",
    );
    expect(safe).toBe("https://patungin.example/s/[token]");
  });
  it("keeps bill route counts while redacting the concrete bill ID", () => {
    expect(
      sanitizeAnalyticsUrl(
        "https://patungin.example/bills/bill_123/result?photo=failed",
      ),
    ).toBe("https://patungin.example/bills/[id]/result");
  });
  it("drops malformed event URLs and preserves ordinary page paths", () => {
    expect(sanitizeAnalyticsUrl("not a URL")).toBeNull();
    expect(
      sanitizeAnalyticsUrl("https://patungin.example/settings/payments"),
    ).toBe("https://patungin.example/settings/payments");
  });
});
