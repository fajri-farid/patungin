import { createPrivateKey } from "node:crypto";
import { GoogleAuth, JWT } from "google-auth-library";

/**
 * @typedef {{ projectId: string, clientEmail: string, privateKey: string }} ServiceAccountConfig
 */

const scopes = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/identitytoolkit",
  "https://www.googleapis.com/auth/userinfo.email",
];

/**
 * Construct a service-account client explicitly, without parsing credential JSON
 * through GoogleAuth.fromJSON(). Shared by the server and the setup CLI.
 * @param {ServiceAccountConfig} config
 */
export function createServiceAccountJwt(config) {
  if (!config.projectId?.trim() || !config.clientEmail?.trim() || !config.privateKey?.trim()) {
    throw new Error("Konfigurasi service account Firebase belum lengkap.");
  }
  const key = config.privateKey.replace(/\\n/g, "\n").trim();
  let parsedKey;
  try {
    parsedKey = createPrivateKey(key);
  } catch {
    throw new Error("Private key service account Firebase bukan PEM yang valid.");
  }
  if (parsedKey.asymmetricKeyType !== "rsa") {
    throw new Error("Private key service account Firebase harus berupa RSA.");
  }
  return new JWT({ email: config.clientEmail.trim(), key, scopes: [...scopes] });
}

/**
 * Firebase Admin's public Credential interface accepts an OAuth token provider.
 * Let JWT handle caching/refresh; report the real remaining token lifetime.
 * @param {JWT} client
 * @returns {import("firebase-admin/app").Credential}
 */
export function createFirebaseCredential(client) {
  return {
    async getAccessToken() {
      const { token } = await client.getAccessToken();
      const expiry = client.credentials.expiry_date;
      const expiresIn = typeof expiry === "number"
        ? Math.floor((expiry - Date.now()) / 1000)
        : 0;
      if (!token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
        throw new Error("Google tidak mengembalikan access token dengan masa berlaku yang valid.");
      }
      return { access_token: token, expires_in: expiresIn };
    },
  };
}

/**
 * Firestore/GAX expects a GoogleAuth wrapper with an explicit authClient.
 * Use a separate JWT instance so Firestore's auth options cannot affect Auth.
 * @param {ServiceAccountConfig} config
 */
export function createFirestoreAuth(config) {
  return new GoogleAuth({
    projectId: config.projectId,
    authClient: createServiceAccountJwt(config),
  });
}
