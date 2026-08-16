import { createHash } from "node:crypto";
import path from "node:path";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function parseInteger(value, description) {
  if (Number.isInteger(value)) return value;
  if (typeof value === "string" && /^(?:0x[0-9a-f]+|\d+)$/iu.test(value)) {
    return Number.parseInt(value, value.toLowerCase().startsWith("0x") ? 16 : 10);
  }
  throw new Error(`${description} must be an integer or hexadecimal integer string.`);
}

export function resolveInside(root, candidate, description) {
  if (typeof candidate !== "string" || candidate.length === 0 || path.isAbsolute(candidate)) {
    throw new Error(`${description} must be a non-empty relative path.`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(root, candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${description} escapes its allowed root.`);
  }
  return resolved;
}

export function hex(value) {
  return `0x${(value >>> 0).toString(16)}`;
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
