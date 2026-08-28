import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import { WORKSPACE_ROOT } from "./constants.mjs";

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

// Device receipts and approvals are immutable, SHA-256-pinned evidence: they record the
// absolute artifact paths of the machine that performed the physical flash. Re-root such a
// recorded path onto this workspace so any clone resolves the same bytes. The recorded
// SHA-256 is still verified by the caller, which is what actually gates the artifact; this
// only decides which file to open. When nothing matches, the recorded path is returned
// unchanged so the caller still fails closed with its original diagnostics.
export function resolveRecordedPath(recordedPath) {
  if (typeof recordedPath !== "string" || recordedPath.length === 0) return recordedPath;
  if (existsSync(recordedPath)) return recordedPath;
  const segments = recordedPath.split(/[\\/]+/u).filter(Boolean);
  const prefix = `${WORKSPACE_ROOT}${path.sep}`;
  for (let index = 0; index < segments.length; index += 1) {
    const candidate = path.join(WORKSPACE_ROOT, ...segments.slice(index));
    if (candidate.startsWith(prefix) && existsSync(candidate)) return candidate;
  }
  return recordedPath;
}

// Compare a path recorded in immutable evidence against a local expectation without
// depending on where the workspace happens to be checked out. The recorded absolute path
// and the expectation must denote the same workspace-relative artifact; unlike
// resolveRecordedPath this does not require the file to exist, so it stays usable for
// approval documents whose artifacts live only on the machine that flashed them.
export function recordedPathMatches(recordedPath, expectedAbsolutePath) {
  if (typeof recordedPath !== "string" || recordedPath.length === 0) return false;
  const expected = path.resolve(expectedAbsolutePath);
  if (path.resolve(resolveRecordedPath(recordedPath)) === expected) return true;
  const relative = path.relative(WORKSPACE_ROOT, expected);
  if (relative.length === 0 || relative.startsWith("..") || path.isAbsolute(relative)) return false;
  const tail = relative.split(path.sep).join("/");
  const recorded = recordedPath.split(/[\\/]+/u).filter(Boolean).join("/");
  return recorded === tail || recorded.endsWith(`/${tail}`);
}
