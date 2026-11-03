export interface BillCursor {
  updatedAt: string;
  id: string;
}

export function encodeBillCursor(cursor: BillCursor): string {
  return Buffer.from(JSON.stringify([cursor.updatedAt, cursor.id])).toString(
    "base64url",
  );
}

export function decodeBillCursor(value: string): BillCursor | null {
  if (!value || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value))
    return null;
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (!Array.isArray(decoded) || decoded.length !== 2) return null;
    const [updatedAt, id] = decoded;
    if (
      typeof updatedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(updatedAt) ||
      Number.isNaN(Date.parse(updatedAt)) ||
      new Date(updatedAt).toISOString() !== updatedAt ||
      typeof id !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(id)
    )
      return null;
    const cursor = { updatedAt, id };
    return encodeBillCursor(cursor) === value ? cursor : null;
  } catch {
    return null;
  }
}

// Firestore orders both fields descending; the ID breaks equal-timestamp ties.
export function compareBillCursors(a: BillCursor, b: BillCursor): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
  return a.id === b.id ? 0 : a.id > b.id ? -1 : 1;
}
