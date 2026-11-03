/**
 * Inisialisasi Firebase Client SDK (Khusus Google Login di Browser)
 *
 * Sesuai arsitektur: Client SDK hanya dipakai untuk Google Sign-In.
 * Seluruh pembacaan/penulisan data tagihan tetap melewati server (bukan Firestore browser).
 */

import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  initializeAuth,
  inMemoryPersistence,
  type Auth,
} from "firebase/auth";

export function isFirebaseClientConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() &&
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() &&
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()
  );
}

export function getFirebaseClientAuth(): {
  app: FirebaseApp;
  auth: Auth;
  googleProvider: GoogleAuthProvider;
} {
  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim(),
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim(),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim(),
  };

  const existing = getApps();
  const app = existing.length > 0 ? existing[0] : initializeApp(firebaseConfig);
  // The browser only needs a temporary identity to exchange for an HttpOnly
  // server session. Configure persistence synchronously so opening the popup
  // remains inside the user's click gesture (important for mobile browsers).
  const auth = initializeAuth(app, {
    persistence: inMemoryPersistence,
    popupRedirectResolver: browserPopupRedirectResolver,
  });
  const googleProvider = new GoogleAuthProvider();
  googleProvider.setCustomParameters({
    prompt: "select_account",
  });

  return { app, auth, googleProvider };
}
