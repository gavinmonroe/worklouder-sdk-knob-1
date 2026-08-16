export const BUBBLE_METHOD = "v.framer.bubble";
export const MAX_BUBBLE_LABEL_BYTES = 32;
export const MAX_BUBBLE_VALUE_BYTES = 64;

function validateText(name, value, maxBytes) {
  if (typeof value !== "string") {
    throw new TypeError(`${name} must be a string.`);
  }
  if (value.length === 0 || value.trim().length === 0) {
    throw new TypeError(`${name} must not be empty.`);
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${name} must not contain control characters.`);
  }
  const byteLength = Buffer.byteLength(value, "utf8");
  if (byteLength > maxBytes) {
    throw new RangeError(`${name} must be at most ${maxBytes} UTF-8 bytes; received ${byteLength}.`);
  }
  return value;
}

function validateU8Boolean(name, value) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be an integer.`);
  }
  if (value !== 0 && value !== 1) {
    throw new RangeError(`${name} must be 0 or 1.`);
  }
  return value;
}

/**
 * Validates the firmware's compact l/v/d/s payload. The firmware binary only
 * uses string/string/u8-boolean/u8-boolean types. d controls the 8x8 status
 * dot and s controls bubble visibility.
 */
export function validateBubblePayload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Bubble params must be an object.");
  }

  const expectedKeys = ["d", "l", "s", "v"];
  const actualKeys = Object.keys(input).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new TypeError("Bubble params must contain exactly l, v, d, and s.");
  }

  return Object.freeze({
    l: validateText("l/label", input.l, MAX_BUBBLE_LABEL_BYTES),
    v: validateText("v/value", input.v, MAX_BUBBLE_VALUE_BYTES),
    d: validateU8Boolean("d/status dot", input.d),
    s: validateU8Boolean("s/visibility", input.s),
  });
}
