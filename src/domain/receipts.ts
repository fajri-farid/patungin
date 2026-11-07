export const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;

export interface ReceiptPhotoRecord {
  id: string;
  billId: string;
  ownerUid: string;
  objectPath: string;
  objectGeneration: string | null;
  status: "uploading" | "ready" | "cleanup_pending" | "deleted";
  imageHash: string;
  contentType: "image/jpeg";
  sizeBytes: number;
  createdAt: string;
  expiresAt: string;
  nextCleanupAt: string;
  cleanupAttempts: number;
  deletedAt: string | null;
  deleteAfter?: Date;
}

export interface ReceiptPhotoInfo {
  status: "available" | "expired" | "missing" | "disabled" | "unavailable";
  id?: string;
  expiresAt?: string;
}

export function receiptPhotoInfo(
  photo: ReceiptPhotoRecord | null,
  now = Date.now(),
): ReceiptPhotoInfo {
  if (!photo) return { status: "missing" };
  if (now >= Date.parse(photo.expiresAt))
    return { status: "expired", expiresAt: photo.expiresAt };
  return photo.status === "ready"
    ? { status: "available", id: photo.id, expiresAt: photo.expiresAt }
    : { status: "missing" };
}
