export interface UserAccount {
  uid: string;
  email: string;
  displayName: string;
  searchName?: string;
  status: "pending" | "active" | "disabled";
  accessUntil: string | null;
  monthlyLimit: number;
  activatedAt: string | null;
  source: "invite" | "direct" | "legacy" | "admin" | null;
  createdAt: string;
  updatedAt: string;
  claimWindowAt?: number;
  claimFailures?: number;
}

export interface InviteRecord {
  id: string;
  kind: "code" | "email";
  label: string;
  email: string | null;
  active: boolean;
  expiresAt: string | null;
  maxClaims: number;
  claimCount: number;
  accessDays: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccessIdentity {
  uid: string;
  email: string;
  displayName: string;
}

export class AccessError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 403,
  ) {
    super(message);
  }
}
