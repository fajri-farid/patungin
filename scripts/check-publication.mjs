import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { parseEnv } from "node:util";

// Prints only paths and categories, never matching credentials or file contents.
// A narrow guardrail, not a replacement for hosted secret scanning or review.
const git = (...args) => execFileSync("git", args, { maxBuffer: 128 * 1024 * 1024 });
const files = git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
  .toString().split("\0").filter(Boolean);
const findings = new Set();
const knownSecrets = [];
for (const file of [".env", ".env.local", ".env.production.local"]) {
  if (!fs.existsSync(file)) continue;
  for (const [name, value] of Object.entries(parseEnv(fs.readFileSync(file, "utf8")))) {
    if (/^(FIREBASE_PRIVATE_KEY|GEMINI_API_KEY|.*_SECRET)$/.test(name) && value.length >= 24) {
      knownSecrets.push(value, value.replaceAll("\\n", "\n"));
    }
  }
}
function inspect(label, buffer) {
  if (buffer.includes(0)) return; // Skip binary artifacts.
  const source = buffer.toString("utf8");
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s*(?:\\n)?[A-Za-z0-9+/=\\\r\n]{80,}/.test(source))
    findings.add(`${label}: private key material`);
  if (/\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,}|AIza[0-9A-Za-z_-]{35})\b/.test(source))
    findings.add(`${label}: credential-shaped value (review required)`);
  if (knownSecrets.some(secret => source.includes(secret)))
    findings.add(`${label}: matches a local server secret`);
}
for (const file of new Set(files)) {
  if (/(^|\/)\.env(?:\.|$)/.test(file) && file !== ".env.example")
    findings.add(`${file}: environment file must stay private`);
  if (/(^|\/)(?:\.patungin-(?:receipts|qris)\/|\.patungin-dev-data\.json|service-account[^/]*\.json|[^/]*firebase-adminsdk[^/]*\.json)/.test(file))
    findings.add(`${file}: local data or credential file`);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) inspect(file, fs.readFileSync(file));
}
// The index may still contain a credential even after a working-tree fix.
for (const file of git("ls-files", "-z").toString().split("\0").filter(Boolean)) {
  inspect(`index:${file}`, git("show", `:${file}`));
}
let blobs = 0;
if (process.argv.includes("--history")) {
  const objects = git("rev-list", "--objects", "--all").toString().trim().split("\n")
    .filter(line => /^[a-f0-9]+ .+/.test(line))
    .map(line => ({ id: line.slice(0, line.indexOf(" ")), path: line.slice(line.indexOf(" ") + 1) }));
  // Trees are ignored by cat-file's type field. Batch avoids one process per object.
  const data = execFileSync("git", ["cat-file", "--batch"], {
    input: objects.map(object => object.id).join("\n") + "\n", maxBuffer: 128 * 1024 * 1024,
  });
  let offset = 0;
  for (const object of objects) {
    const end = data.indexOf(10, offset);
    const [, type, rawSize] = data.subarray(offset, end).toString().split(" ");
    const size = Number(rawSize);
    if (!Number.isSafeInteger(size)) throw new Error("Unexpected Git object response");
    const body = data.subarray(end + 1, end + 1 + size);
    if (type === "blob") { inspect(`history:${object.path}@${object.id.slice(0, 10)}`, body); blobs++; }
    offset = end + 1 + size + 1;
  }
}
for (const finding of findings) console.error(finding);
console.log(`Publication check: ${new Set(files).size} files, ${blobs} history blobs, ${findings.size} findings.`);
if (findings.size) process.exitCode = 1;
