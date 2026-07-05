import { env } from "@hosted-agents/env/server";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const CIPHER = "aes-256-gcm";
const IV_BYTES = 12;

type EncryptedPayload = {
  version: 1;
  algorithm: typeof CIPHER;
  iv: string;
  authTag: string;
  ciphertext: string;
};

function getCredentialEncryptionKey() {
  return createHash("sha256")
    .update(env.AGENT_CREDENTIAL_ENCRYPTION_KEY ?? env.BETTER_AUTH_SECRET)
    .digest();
}

function parsePayload(payload: string) {
  const parsed = JSON.parse(payload) as EncryptedPayload;

  if (parsed.version !== 1 || parsed.algorithm !== CIPHER) {
    throw new Error("Unsupported credential payload.");
  }

  return parsed;
}

export function encryptJsonCredential(value: unknown) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, getCredentialEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);

  return JSON.stringify({
    version: 1,
    algorithm: CIPHER,
    iv: iv.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  } satisfies EncryptedPayload);
}

export function decryptJsonCredential<T>(payload: string) {
  const parsed = parsePayload(payload);
  const decipher = createDecipheriv(
    CIPHER,
    getCredentialEncryptionKey(),
    Buffer.from(parsed.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(parsed.authTag, "base64url"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");

  return JSON.parse(plaintext) as T;
}
