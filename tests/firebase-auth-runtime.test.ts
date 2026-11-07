import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("loads Firebase Auth and resolves signing keys with require(esm) disabled", () => {
  // Use a real Node subprocess so Vitest's module loader cannot mask ERR_REQUIRE_ESM.
  // Generate a disposable key and inject the JWKS response; no Firebase credentials
  // or network access are needed.
  const result = spawnSync(process.execPath, ["--no-experimental-require-module", "-e", `
    const assert = require('node:assert/strict');
    const { createRequire } = require('node:module');
    const { generateKeyPairSync, createPublicKey, sign, verify } = require('node:crypto');
    const { getAuth } = require('firebase-admin/auth');
    assert.equal(typeof getAuth, 'function');
    const firebaseRequire = createRequire(require.resolve('firebase-admin/auth'));
    const jwksClient = firebaseRequire('jwks-rsa');
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
    const options = {
      jwksUri: 'https://unused.invalid/jwks',
      cache: false,
      fetcher: async () => ({ keys: [jwk] }),
    };
    const client = jwksClient(options);
    (async () => {
      const key = await client.getSigningKey('test-key');
      const resolvedKey = createPublicKey(key.getPublicKey());
      assert.deepEqual(resolvedKey.export({ format: 'jwk' }), publicKey.export({ format: 'jwk' }));
      const payload = Buffer.from('test payload');
      assert.ok(verify('RSA-SHA256', payload, resolvedKey, sign('RSA-SHA256', payload, privateKey)));
      await assert.rejects(client.getSigningKey('missing-key'), { name: 'SigningKeyNotFoundError' });
      const secretProvider = jwksClient.passportJwtSecret(options);
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
      const token = header + '.' + Buffer.from('{}').toString('base64url') + '.test';
      const getSecret = (rawToken) => new Promise((resolve, reject) => {
        secretProvider({}, rawToken, (error, secret) => error ? reject(error) : resolve(secret));
      });
      assert.equal(await getSecret(token), key.getPublicKey());
      assert.equal(await getSecret('invalid-token'), null);
      console.log('Firebase Auth runtime OK');
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
    timeout: 15_000,
  });

  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("Firebase Auth runtime OK");
});
