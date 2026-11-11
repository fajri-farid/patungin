export class RequestInterruptedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestInterruptedError";
  }
}

export interface ApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
}

/** Bound the whole request, including body consumption. Never retry a mutation automatically. */
export async function requestJson<T = unknown>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 90_000,
): Promise<{ response: Response; result: ApiResult<T> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || !("ok" in result) || typeof result.ok !== "boolean") {
      throw new Error("Invalid API response");
    }
    // Only the application's structured errors are eligible for display.
    if ("error" in result && result.error !== undefined && typeof result.error !== "string") {
      throw new Error("Invalid API error");
    }
    return { response, result: result as ApiResult<T> };
  } catch {
    throw new RequestInterruptedError(controller.signal.aborted
      ? "Proses belum bisa dipastikan. Cek apakah perubahan sudah tersimpan sebelum mencoba lagi."
      : "Hasil belum diterima. Cek apakah perubahan sudah tersimpan sebelum mencoba lagi.");
  } finally {
    clearTimeout(timer);
  }
}
