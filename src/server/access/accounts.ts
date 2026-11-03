import crypto from "node:crypto";
import { FieldPath, type Transaction } from "@google-cloud/firestore";
import { getServerConfig, normalizeEmail } from "../config/env";
import { getAdminFirestore } from "../firebase/admin";
import { readDevDb, writeDevDb } from "../store/dev-database";
import {
  makeSummary,
  normalizeSearchName,
  summaryId,
  type UserMonthSummary,
  type AccountSettings,
} from "../admin/summary";
import {
  AccessError,
  type AccessIdentity,
  type InviteRecord,
  type UserAccount,
} from "./types";

// Serialize sandbox access transactions too; production uses Firestore transactions.
let sandboxQueue: Promise<unknown> = Promise.resolve();
export async function accessTransaction<T>(
  callback: (store: AccessStore) => Promise<T>,
): Promise<T> {
  if (!getServerConfig().isDevSandbox) {
    return getAdminFirestore().runTransaction((tx) =>
      callback(new AccessStore(tx)),
    );
  }
  const result = sandboxQueue.then(async () => {
    const store = new AccessStore();
    const value = await callback(store);
    store.commit();
    return value;
  });
  sandboxQueue = result.catch(() => undefined);
  return result;
}

export class AccessStore {
  private changes: Array<() => void> = [];
  constructor(private tx?: Transaction) {}
  async get<T>(
    collection:
      "users" | "invites" | "usageMonths" | "adminUserMonths" | "accountAudits",
    id: string,
  ): Promise<T | null> {
    if (this.tx) {
      const snap = await this.tx.get(
        getAdminFirestore().collection(collection).doc(id),
      );
      return snap.exists ? (snap.data() as T) : null;
    }
    return structuredClone(readDevDb()[collection][id] ?? null) as T | null;
  }
  set(
    collection:
      "users" | "invites" | "usageMonths" | "adminUserMonths" | "accountAudits",
    id: string,
    data: object,
  ) {
    if (this.tx)
      this.tx.set(getAdminFirestore().collection(collection).doc(id), data);
    else
      this.changes.push(() => {
        Object.assign(readDevDb()[collection], { [id]: data });
      });
  }
  commit() {
    this.changes.forEach((change) => change());
    if (this.changes.length) writeDevDb(readDevDb());
  }
}

export function isAdmin(
  identity: Pick<AccessIdentity, "uid" | "email">,
): boolean {
  const config = getServerConfig();
  return (
    config.adminUids.has(identity.uid) ||
    config.adminEmails.has(normalizeEmail(identity.email))
  );
}

export function accountIsActive(account: UserAccount | null): boolean {
  return (
    !!account &&
    account.status === "active" &&
    (account.accessUntil === null ||
      Date.now() < Date.parse(account.accessUntil))
  );
}

export async function getAccount(uid: string): Promise<UserAccount | null> {
  if (getServerConfig().isDevSandbox)
    return structuredClone(readDevDb().users[uid] ?? null);
  const snap = await getAdminFirestore().collection("users").doc(uid).get();
  return snap.exists ? (snap.data() as UserAccount) : null;
}

// Existing allowlisted owners retain access until an explicit account record takes over.
export async function hasProductAccess(
  uid: string,
  email: string,
): Promise<boolean> {
  if (isAdmin({ uid, email })) return true;
  const account = await getAccount(uid);
  return account
    ? accountIsActive(account)
    : getServerConfig().allowedEmails.has(normalizeEmail(email));
}

export function monthKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Makassar",
    year: "numeric",
    month: "2-digit",
  }).format(now);
}

export function normalizeCode(value: unknown): string {
  if (typeof value !== "string")
    throw new AccessError("INVALID_CODE", "Masukkan kode undangan.", 400);
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9-]{8,24}$/.test(code))
    throw new AccessError(
      "INVALID_CODE",
      "Kode harus 8–24 huruf, angka, atau tanda hubung.",
      400,
    );
  return code;
}

function inviteId(kind: "code" | "email", value: string): string {
  const secret =
    process.env.INVITE_SIGNING_SECRET?.trim() ||
    getServerConfig().share.signingSecret;
  if (secret.length < 32)
    throw new AccessError(
      "INVITES_NOT_CONFIGURED",
      "Undangan belum tersedia. Hubungi admin.",
      503,
    );
  return `${kind}_${crypto.createHmac("sha256", secret).update(`patungin-invite-v1:${kind}:${value}`).digest("hex")}`;
}

function newAccount(identity: AccessIdentity): UserAccount {
  const now = new Date().toISOString();
  const admin = isAdmin(identity);
  const legacy = getServerConfig().allowedEmails.has(
    normalizeEmail(identity.email),
  );
  return {
    ...identity,
    email: normalizeEmail(identity.email),
    searchName: normalizeSearchName(identity.displayName),
    status: admin || legacy ? "active" : "pending",
    accessUntil: null,
    monthlyLimit: getServerConfig().limits.monthlyUserLimit,
    activatedAt: admin || legacy ? now : null,
    source: admin ? "admin" : legacy ? "legacy" : null,
    createdAt: now,
    updatedAt: now,
  };
}

function validInvite(invite: InviteRecord | null): invite is InviteRecord {
  return (
    !!invite &&
    invite.active &&
    invite.claimCount < invite.maxClaims &&
    (invite.expiresAt === null || Date.now() < Date.parse(invite.expiresAt))
  );
}

function activate(account: UserAccount, invite: InviteRecord): UserAccount {
  const now = new Date().toISOString();
  return {
    ...account,
    status: "active",
    source: invite.kind === "email" ? "direct" : "invite",
    activatedAt: now,
    accessUntil:
      invite.accessDays === null
        ? null
        : new Date(Date.now() + invite.accessDays * 86400000).toISOString(),
    updatedAt: now,
  };
}

/** Invoked only after Google identity/email verification, never from client-supplied identity. */
export async function ensureAccount(
  identity: AccessIdentity,
): Promise<UserAccount> {
  const email = normalizeEmail(identity.email);
  // Email grants use a non-secret digest; code digests require a keyed verifier.
  const id = emailInviteId(email);
  return accessTransaction(async (store) => {
    const [existing, invite] = await Promise.all([
      store.get<UserAccount>("users", identity.uid),
      store.get<InviteRecord>("invites", id),
    ]);
    let account = existing ?? newAccount(identity);
    if (account.status === "pending" && validInvite(invite)) {
      account = activate(account, invite);
      store.set("invites", id, {
        ...invite,
        claimCount: invite.claimCount + 1,
        updatedAt: new Date().toISOString(),
      });
    }
    if (account.searchName !== normalizeSearchName(account.displayName))
      account = {
        ...account,
        searchName: normalizeSearchName(account.displayName),
      };
    if (!existing || account !== existing)
      store.set("users", identity.uid, account);
    return account;
  });
}

function emailInviteId(email: string) {
  return `email_${crypto.createHash("sha256").update(normalizeEmail(email)).digest("hex")}`;
}

export async function claimInvite(
  identity: AccessIdentity,
  rawCode: unknown,
): Promise<void> {
  // Count malformed submissions as well; identity is verified before entering here.
  const outcome = await accessTransaction(async (store) => {
    const account =
      (await store.get<UserAccount>("users", identity.uid)) ??
      newAccount(identity);
    if (isAdmin(identity) || accountIsActive(account)) return "active";
    if (account.status !== "pending") return "disabled";
    const now = Date.now();
    const windowAt = account.claimWindowAt ?? 0;
    const failures =
      now - windowAt < 15 * 60000 ? (account.claimFailures ?? 0) : 0;
    if (failures >= 5) return "limited";
    let invite: InviteRecord | null = null;
    try {
      invite = await store.get<InviteRecord>(
        "invites",
        inviteId("code", normalizeCode(rawCode)),
      );
    } catch (error) {
      if (!(error instanceof AccessError) || error.statusCode === 503)
        throw error;
    }
    if (!validInvite(invite)) {
      store.set("users", identity.uid, {
        ...account,
        claimWindowAt: failures ? windowAt : now,
        claimFailures: failures + 1,
      });
      return "invalid";
    }
    store.set("users", identity.uid, {
      ...activate(account, invite),
      claimFailures: 0,
    });
    store.set("invites", invite.id, {
      ...invite,
      claimCount: invite.claimCount + 1,
      updatedAt: new Date().toISOString(),
    });
    return "active";
  });
  if (outcome === "limited")
    throw new AccessError(
      "CLAIM_RATE_LIMIT",
      "Terlalu banyak percobaan. Coba lagi dalam 15 menit.",
      429,
    );
  if (outcome === "disabled")
    throw new AccessError(
      "ACCESS_DISABLED",
      "Hubungi admin untuk mengaktifkan kembali akses akun.",
    );
  if (outcome !== "active")
    throw new AccessError(
      "INVITE_INVALID",
      "Kode tidak tersedia, sudah penuh, atau kedaluwarsa.",
      400,
    );
}

function integer(value: unknown, max = 10000): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > max
  )
    throw new AccessError(
      "INVALID_NUMBER",
      `Isi angka bulat antara 0 dan ${max}.`,
      400,
    );
  return value;
}
function futureDate(value: unknown, allowPast = false): string | null {
  if (value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    (!allowPast && Date.parse(value) <= Date.now())
  )
    throw new AccessError(
      "INVALID_DATE",
      "Pilih waktu mendatang dalam WITA.",
      400,
    );
  return new Date(value).toISOString();
}

export interface CreateInviteInput {
  code?: string;
  email?: string;
  label: string;
  expiresAt: string | null;
  maxClaims: number;
  accessDays: number | null;
}
export async function createInvite(
  input: CreateInviteInput,
): Promise<{ code: string | null }> {
  const email = input.email ? normalizeEmail(input.email) : null;
  if (
    email &&
    (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
  )
    throw new AccessError(
      "INVALID_EMAIL",
      "Masukkan email Google yang valid.",
      400,
    );
  const kind = email ? "email" : "code";
  const code = email
    ? null
    : normalizeCode(input.code || crypto.randomBytes(8).toString("hex"));
  const id = email ? emailInviteId(email) : inviteId("code", code!);
  const maxClaims = email ? 1 : integer(input.maxClaims);
  if (maxClaims < 1)
    throw new AccessError("INVALID_LIMIT", "Batas klaim minimal 1 akun.", 400);
  const accessDays =
    input.accessDays === null ? null : integer(input.accessDays, 3650);
  if (accessDays === 0)
    throw new AccessError(
      "INVALID_ACCESS",
      "Masa akses minimal satu hari.",
      400,
    );
  if (typeof input.label !== "string" || input.label.trim().length > 80)
    throw new AccessError(
      "INVALID_LABEL",
      "Nama undangan maksimal 80 karakter.",
      400,
    );
  const expiresAt = futureDate(input.expiresAt);
  await accessTransaction(async (store) => {
    const existing = await store.get<InviteRecord>("invites", id);
    if (existing)
      throw new AccessError(
        "INVITE_EXISTS",
        "Kode atau undangan email ini sudah pernah dibuat. Kelola undangan yang ada atau gunakan kode baru.",
        409,
      );
    const now = new Date().toISOString();
    store.set("invites", id, {
      id,
      kind,
      email,
      label: input.label.trim() || (email ? "Akses email" : "Undangan baru"),
      active: true,
      expiresAt,
      maxClaims,
      claimCount: 0,
      accessDays,
      createdAt: now,
      updatedAt: now,
    } satisfies InviteRecord);
  });
  return { code };
}

export async function setInviteActive(id: string, active: boolean) {
  if (!/^(code|email)_[a-f0-9]{64}$/.test(id) || typeof active !== "boolean")
    throw new AccessError("INVALID_INVITE", "Undangan tidak valid.", 400);
  await accessTransaction(async (store) => {
    const invite = await store.get<InviteRecord>("invites", id);
    if (!invite)
      throw new AccessError("NOT_FOUND", "Undangan tidak ditemukan.", 404);
    store.set("invites", id, {
      ...invite,
      active,
      updatedAt: new Date().toISOString(),
    });
  });
}

export interface UpdateAccountInput {
  uid: string;
  status: "pending" | "active" | "disabled";
  accessUntil: string | null;
  monthlyLimit: number;
  bonus: number;
  usageMonth?: string;
  expectedUpdatedAt?: string;
  expectedBonus?: number;
}
export async function updateAccount(
  actor: AccessIdentity,
  input: UpdateAccountInput,
): Promise<void> {
  if (!isAdmin(actor))
    throw new AccessError(
      "ADMIN_REQUIRED",
      "Hanya admin yang dapat mengubah akun.",
    );
  if (
    typeof input.uid !== "string" ||
    !input.uid ||
    input.uid.includes("/") ||
    !["pending", "active", "disabled"].includes(input.status)
  )
    throw new AccessError("INVALID_ACCOUNT", "Akun tidak valid.", 400);
  const monthlyLimit = integer(input.monthlyLimit);
  const bonus = integer(input.bonus);
  const accessUntil = futureDate(input.accessUntil, true);
  const key = monthKey();
  const auditId = crypto.randomUUID();
  if (input.usageMonth !== undefined && input.usageMonth !== key)
    throw new AccessError(
      "MONTH_CHANGED",
      "Bulan sudah berganti. Muat ulang sebelum mengatur bonus.",
      409,
    );
  await accessTransaction(async (store) => {
    const [account, usage, summary] = await Promise.all([
      store.get<UserAccount>("users", input.uid),
      store.get<Record<string, unknown>>("usageMonths", key),
      store.get<UserMonthSummary>("adminUserMonths", summaryId(input.uid, key)),
    ]);
    if (!account)
      throw new AccessError("NOT_FOUND", "Akun tidak ditemukan.", 404);
    const currentBonus =
      ((usage?.userBonuses ?? {}) as Record<string, number>)[input.uid] ?? 0;
    if (
      (input.expectedUpdatedAt !== undefined &&
        input.expectedUpdatedAt !== account.updatedAt) ||
      (input.expectedBonus !== undefined &&
        input.expectedBonus !== currentBonus)
    )
      throw new AccessError(
        "ACCOUNT_CHANGED",
        "Pengaturan akun sudah berubah. Tutup panel dan perbarui data sebelum menyimpan lagi.",
        409,
      );
    if (isAdmin(account) && (input.status !== "active" || accessUntil !== null))
      throw new AccessError(
        "ADMIN_PROTECTED",
        "Akses admin dikelola melalui konfigurasi server.",
        400,
      );
    const now = new Date(
      Math.max(Date.now(), Date.parse(account.updatedAt) + 1),
    ).toISOString();
    const before: AccountSettings = {
      status: account.status,
      accessUntil: account.accessUntil,
      monthlyLimit: account.monthlyLimit,
      bonus: currentBonus,
    };
    const after: AccountSettings = {
      status: input.status,
      accessUntil,
      monthlyLimit,
      bonus,
    };
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    store.set("accountAudits", auditId, {
      id: auditId,
      ownerUid: input.uid,
      actorUid: actor.uid,
      actorEmail: actor.email,
      createdAt: now,
      monthKey: key,
      before,
      after,
      deleteAfter: new Date(Date.parse(now) + 365 * 86400000),
    });
    store.set(
      "adminUserMonths",
      summaryId(input.uid, key),
      makeSummary(summary, {
        uid: input.uid,
        monthKey: key,
        used:
          ((usage?.userAttempts ?? {}) as Record<string, number>)[input.uid] ??
          0,
        limit: monthlyLimit,
        bonus,
        now,
      }),
    );
    store.set("users", input.uid, {
      ...account,
      searchName: normalizeSearchName(account.displayName),
      status: input.status,
      source: account.source ?? (input.status === "active" ? "direct" : null),
      accessUntil,
      monthlyLimit,
      activatedAt:
        input.status === "active"
          ? (account.activatedAt ?? new Date().toISOString())
          : account.activatedAt,
      updatedAt: now,
    });
    const bonuses = (usage?.userBonuses ?? {}) as Record<string, number>;
    store.set("usageMonths", key, {
      dateKey: key,
      deploymentAttempts: 0,
      userAttempts: {},
      activeLeases: {},
      activeLeaseOwners: {},
      userMinuteWindows: {},
      ...usage,
      userBonuses: { ...bonuses, [input.uid]: bonus },
      deleteAfter: retentionDate(key),
    });
  });
}

export function retentionDate(key: string): Date {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month, 1, -8) + 30 * 86400000);
}

// Cursor pagination bounds admin reads without introducing a search service.
export async function listAccessRecords<K extends "users" | "invites">(
  collection: K,
  after?: string,
): Promise<{
  records: Array<K extends "users" ? UserAccount : InviteRecord>;
  next: string | null;
  evaluatedAt: number;
}> {
  if (after && (after.includes("/") || after.length > 256))
    throw new AccessError("INVALID_CURSOR", "Halaman tidak valid.", 400);
  let records: Array<UserAccount | InviteRecord>;
  if (getServerConfig().isDevSandbox) {
    records = Object.entries(readDevDb()[collection])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .filter(([id]) => !after || id > after)
      .slice(0, 26)
      .map(([, data]) => structuredClone(data));
  } else {
    let query = getAdminFirestore()
      .collection(collection)
      .orderBy(FieldPath.documentId())
      .limit(26);
    if (after) query = query.startAfter(after);
    records = (await query.get()).docs.map(
      (doc) => doc.data() as UserAccount | InviteRecord,
    );
  }
  const page = records.slice(0, 25);
  const last = page.at(-1);
  return {
    evaluatedAt: Date.now(),
    records: page as Array<K extends "users" ? UserAccount : InviteRecord>,
    next:
      records.length > 25 && last ? ("uid" in last ? last.uid : last.id) : null,
  };
}
