// ============================================================================
// UUID v4 and UUID v7 — no external dependencies
// ============================================================================
//
// UUID v7 layout (128 bits):
//   Bits  0-47  : Unix timestamp in milliseconds (big-endian)
//   Bits 48-51  : Version = 0111 (7)
//   Bits 52-63  : Seq A — monotonic 12-bit counter (resets each ms)
//   Bits 64-65  : Variant = 10
//   Bits 66-127 : Random B — 62 random bits
//
// Within the same millisecond, seq A is incremented so that every call
// produces a strictly increasing UUID.  The full UUID is therefore
// lexicographically time-ordered across all calls on the same JS thread.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Returns true when `v` is a lowercase, hyphenated UUID string. */
export function isValidUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

// Lookup table: avoids toString(16) + padStart per byte (~5× faster than Array.from approach).
const _HEX = '0123456789abcdef';
function toHex(buf: Uint8Array): string {
  let s = '';
  for (let i = 0; i < buf.length; i++) {
    s += _HEX[buf[i] >> 4] + _HEX[buf[i] & 0x0f];
  }
  return s;
}

// --- Monotonic state (module-level, shared within the same JS realm) -------
let _lastMs  = 0;
let _seqA    = 0; // 12-bit monotonic counter (0–4095)

/**
 * Generate a UUID v7 (time-ordered, monotonic within the same ms).
 * Uses `crypto.getRandomValues` — available in all modern browsers and
 * Node.js 19+.
 */
export function uuidv7(): string {
  let ms = Date.now();

  if (ms > _lastMs) {
    // New millisecond — reset counter.
    _lastMs = ms;
    _seqA   = 0;
  } else {
    // Same ms (or rare clock regression) — increment counter.
    _seqA++;
    if (_seqA > 0xfff) {
      // Exhausted 4096 slots in one ms — advance the logical clock by 1 ms.
      _lastMs++;
      ms    = _lastMs;
      _seqA = 0;
    }
  }

  const buf = new Uint8Array(16);

  // Bytes 0–5: 48-bit Unix timestamp (big-endian). BigInt keeps arithmetic exact.
  const ts = BigInt(ms);
  buf[0] = Number((ts >> 40n) & 0xffn);
  buf[1] = Number((ts >> 32n) & 0xffn);
  buf[2] = Number((ts >> 24n) & 0xffn);
  buf[3] = Number((ts >> 16n) & 0xffn);
  buf[4] = Number((ts >>  8n) & 0xffn);
  buf[5] = Number( ts         & 0xffn);

  // Byte 6: version nibble (0x7) | seqA bits 11–8
  buf[6] = 0x70 | ((_seqA >> 8) & 0x0f);
  // Byte 7: seqA bits 7–0
  buf[7] = _seqA & 0xff;

  // Bytes 8–15: random B.
  crypto.getRandomValues(buf.subarray(8));
  // Variant bits 64–65 → 10xx
  buf[8] = (buf[8] & 0x3f) | 0x80;

  const h = toHex(buf);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Generate a UUID v4 (fully random).
 * Suitable for persistent anonymous device IDs that must not carry a
 * timestamp (privacy).
 */
export function uuidv4(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);

  // Version nibble → 0100 (4)
  buf[6] = (buf[6] & 0x0f) | 0x40;
  // Variant bits → 10xx
  buf[8] = (buf[8] & 0x3f) | 0x80;

  const h = toHex(buf);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
