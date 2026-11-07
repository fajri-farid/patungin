"use client";
import { Analytics } from "@vercel/analytics/next";
import { sanitizeAnalyticsUrl } from "@/lib/analytics-privacy";
export function PrivateAnalytics() {
  return (
    <Analytics
      debug={false}
      beforeSend={(event) => {
        const url = sanitizeAnalyticsUrl(event.url);
        return url ? { ...event, url } : null;
      }}
    />
  );
}
