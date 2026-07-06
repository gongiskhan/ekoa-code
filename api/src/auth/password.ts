/**
 * Password hashing (ch09 §9.7 unification): bcrypt at cost 12 for ALL paths (the old
 * first-boot seed used cost 10 — unified here). New hashes only; existing hashes verify.
 */
import bcrypt from 'bcryptjs';

const COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
