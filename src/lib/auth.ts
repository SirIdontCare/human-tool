import crypto from "crypto";

/**
 * Generates a secure, unguessable URL-safe token.
 */
export function generateToken(prefix: "atk" | "otk" = "atk"): string {
  const randomBytes = crypto.randomBytes(24).toString("base64url");
  return `${prefix}_${randomBytes}`;
}

/**
 * Computes a deterministic SHA-256 hash of a token for secure storage.
 */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token.trim()).digest("hex");
}

/**
 * Timing-safe comparison of token hashes.
 */
export function verifyTokenHash(token: string, storedHash: string): boolean {
  if (!token || !storedHash) return false;
  const computed = hashToken(token);
  try {
    return crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(storedHash, "hex"));
  } catch {
    return false;
  }
}
