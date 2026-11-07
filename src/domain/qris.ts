export const QRIS_IMAGE_ID = /^qris_[a-f0-9]{32}$/;
export const MAX_QRIS_BYTES = 2 * 1024 * 1024;
export interface QrisImageRecord {
  id: string;
  ownerUid: string;
  status: "uploading" | "ready" | "cleanup_pending" | "deleted";
  generation: string | null;
  referenceCount: number;
  createdAt: string;
  nextCleanupAt: string;
  cleanupAttempts: number;
  sizeBytes: number;
  deleteAfter?: Date;
}
