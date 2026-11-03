/** Classify SDK failures without returning raw messages, index URLs, or credentials. */
export function classifyQueryError(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const { code, details, message } = error as {
    code?: unknown;
    details?: unknown;
    message?: unknown;
  };
  if (
    (code === 9 || code === "failed-precondition") &&
    [details, message].some(
      (value) => typeof value === "string" && /\bindex(?:es)?\b/i.test(value),
    )
  ) {
    return {
      code: "DATABASE_INDEX_REQUIRED",
      message:
        "Indeks database untuk fitur ini belum siap. Admin deployment perlu menerapkan firestore.indexes.json dan menunggu status Enabled, lalu coba lagi.",
    };
  }
  if (code === 7 || code === "permission-denied")
    return {
      code: "DATABASE_PERMISSION_DENIED",
      message:
        "Server belum memiliki izin membaca data ini. Periksa izin service account Firebase pada deployment.",
    };
  if (
    code === 14 ||
    code === "unavailable" ||
    code === 4 ||
    code === "deadline-exceeded"
  )
    return {
      code: "DATABASE_UNAVAILABLE",
      message:
        "Database sementara tidak dapat dihubungi. Coba lagi beberapa saat.",
    };
  return null;
}
