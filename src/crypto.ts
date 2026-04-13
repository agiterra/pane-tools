/**
 * Ed25519 crypto primitives for crew agent identity.
 *
 * Pure WebCrypto API — no external dependencies.
 * Used for generating agent keypairs and signing JWTs.
 */

export type KeyPair = {
  publicKey: string; // base64-encoded raw Ed25519 public key (32 bytes)
  privateKey: CryptoKey;
};

async function derivePublicKeyB64(privateKey: CryptoKey): Promise<string> {
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  const pubB64Url = jwk.x!;
  const pubB64 = pubB64Url.replace(/-/g, "+").replace(/_/g, "/");
  return pubB64 + "=".repeat((4 - (pubB64.length % 4)) % 4);
}

export async function generateKeyPair(): Promise<KeyPair> {
  const kp = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const publicKey = await derivePublicKeyB64(kp.privateKey);
  return { publicKey, privateKey: kp.privateKey };
}

export async function exportPrivateKey(privateKey: CryptoKey): Promise<string> {
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", privateKey);
  return Buffer.from(pkcs8).toString("base64");
}

export async function importPrivateKey(base64Pkcs8: string): Promise<CryptoKey> {
  const pkcs8 = Uint8Array.from(atob(base64Pkcs8), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", pkcs8, "Ed25519", true, ["sign"]);
}

export async function importKeyPair(base64Pkcs8: string): Promise<KeyPair> {
  const privateKey = await importPrivateKey(base64Pkcs8);
  const publicKey = await derivePublicKeyB64(privateKey);
  return { publicKey, privateKey };
}
