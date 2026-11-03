/**
 * Inisialisasi Firebase Admin SDK (Server-Only)
 *
 * Hanya dijalankan di Node.js runtime pada server.
 * Kredensial tidak pernah diekspos ke bundle client.
 */

import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { Firestore } from "@google-cloud/firestore";
import { getServerConfig } from "../config/env";
import {
  createFirebaseCredential,
  createFirestoreAuth,
  createServiceAccountJwt,
} from "./credentials.mjs";

let cachedApp: App | null = null;
let cachedFirestore: Firestore | null = null;
const ADMIN_APP_NAME = "patungin-admin-jwt";

export function getFirebaseAdminApp(): App {
  const config = getServerConfig();
  if (!config.firebase.isConfigured) {
    throw new Error(
      "Firebase Admin belum dikonfigurasi. Isi FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, dan FIREBASE_PRIVATE_KEY di .env atau .env.local."
    );
  }

  if (cachedApp) return cachedApp;
  const existing = getApps().find((app) => app.name === ADMIN_APP_NAME);
  if (existing) {
    cachedApp = existing;
    return cachedApp;
  }

  cachedApp = initializeApp({
    credential: createFirebaseCredential(createServiceAccountJwt(config.firebase)),
    projectId: config.firebase.projectId,
  }, ADMIN_APP_NAME);

  return cachedApp;
}

export function getAdminAuth(): Auth {
  return getAuth(getFirebaseAdminApp());
}

export function getAdminFirestore(): Firestore {
  if (cachedFirestore) return cachedFirestore;
  const config = getServerConfig();
  // firebase-admin's Firestore bridge still forwards the deprecated credentials
  // option. Use the same underlying Google Cloud client with explicit auth.
  cachedFirestore = new Firestore({
    projectId: config.firebase.projectId,
    auth: createFirestoreAuth(config.firebase),
  });
  return cachedFirestore;
}
