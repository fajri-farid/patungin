/** Keep page counts without forwarding bearer share tokens, bill IDs or URL parameters. */
export function sanitizeAnalyticsUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname
      .replace(/^\/s\/[^/]+/, "/s/[token]")
      .replace(/^\/bills\/[^/]+/, "/bills/[id]");
    return url.toString();
  } catch {
    return null;
  }
}
