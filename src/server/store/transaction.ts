import { getAdminFirestore } from "../firebase/admin";
import type { Transaction } from "@google-cloud/firestore";
import { getServerConfig } from "../config/env";
import { readDevDb, writeDevDb, type DevDatabaseSchema } from "./dev-database";
import type { QrisImageRecord } from "@/domain/qris";

type Collection = keyof DevDatabaseSchema;
export interface ProductTransaction {
  get<T>(collection: Collection, id: string): Promise<T | null>;
  activeQrisImages(ownerUid: string, maximum: number): Promise<QrisImageRecord[]>;
  set(collection: Collection, id: string, value: object): void;
  delete(collection: Collection, id: string): void;
}
let sandboxQueue: Promise<unknown> = Promise.resolve();
export function firestoreProductTransaction(
  tx: Transaction,
): ProductTransaction {
  const db = getAdminFirestore();
  return {
    async activeQrisImages(ownerUid, maximum) {
      const snapshot = await tx.get(
        db.collection("qrisImages")
          .where("ownerUid", "==", ownerUid)
          .where("status", "in", ["uploading", "ready", "cleanup_pending"])
          .limit(maximum),
      );
      return snapshot.docs.map((doc) => doc.data() as QrisImageRecord);
    },
    async get<T>(collection: Collection, id: string) {
      const snap = await tx.get(db.collection(collection).doc(id));
      return snap.exists ? (snap.data() as T) : null;
    },
    set(collection, id, value) {
      tx.set(db.collection(collection).doc(id), value);
    },
    delete(collection, id) {
      tx.delete(db.collection(collection).doc(id));
    },
  };
}

/** All reads must precede writes. Never perform storage/network side effects in callback. */
export async function productTransaction<T>(
  callback: (tx: ProductTransaction) => Promise<T>,
): Promise<T> {
  if (!getServerConfig().isDevSandbox) {
    const db = getAdminFirestore();
    return db.runTransaction((tx) =>
      callback(firestoreProductTransaction(tx)),
    );
  }
  const run = sandboxQueue.then(async () => {
    const db = readDevDb();
    const writes: Array<() => void> = [];
    const result = await callback({
      async activeQrisImages(ownerUid, maximum) {
        if (writes.length) throw new Error("Reads must precede writes");
        return structuredClone(
          Object.values(db.qrisImages)
            .filter((asset) => asset.ownerUid === ownerUid && asset.status !== "deleted")
            .slice(0, maximum),
        );
      },
      async get<V>(collection: Collection, id: string) {
        if (writes.length) throw new Error("Reads must precede writes");
        return structuredClone(db[collection][id] ?? null) as V | null;
      },
      set(collection, id, value) {
        writes.push(() =>
          Object.assign(db[collection], { [id]: structuredClone(value) }),
        );
      },
      delete(collection, id) {
        writes.push(() => {
          delete db[collection][id];
        });
      },
    });
    writes.forEach((write) => write());
    if (writes.length) writeDevDb(db);
    return result;
  });
  sandboxQueue = run.catch(() => undefined);
  return run;
}

export async function readProductDocument<T>(
  collection: Collection,
  id: string,
): Promise<T | null> {
  if (getServerConfig().isDevSandbox)
    return structuredClone(readDevDb()[collection][id] ?? null) as T | null;
  const snap = await getAdminFirestore().collection(collection).doc(id).get();
  return snap.exists ? (snap.data() as T) : null;
}
