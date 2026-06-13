import { gzipSync, gunzipSync } from 'fflate';

function toUint8Array(input: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (typeof input === 'string') return new TextEncoder().encode(input);
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if ((input as any).buffer && (input as any).byteLength !== undefined) {
    // TypedArray view
    const view = input as ArrayBufferView & { buffer: ArrayBuffer };
    return new Uint8Array(
      view.buffer,
      (view as any).byteOffset || 0,
      (view as any).byteLength || view.buffer.byteLength,
    );
  }
  throw new TypeError('Unsupported input type for gzip');
}

// CRC32 implementation (little, used to validate native gzip output)
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let crc = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function getUint32LE(u8: Uint8Array, offset: number) {
  const dv = new DataView(u8.buffer, u8.byteOffset + offset, 4);
  return dv.getUint32(0, true);
}

function validateNativeGzip(out: Uint8Array, original: Uint8Array): boolean {
  // minimal checks: header, compression method, CRC32 and ISIZE
  if (out.length < 18) return false;
  if (out[0] !== 0x1f || out[1] !== 0x8b) return false; // magic
  if (out[2] !== 8) return false; // deflate
  const crcFromFile = getUint32LE(out, out.length - 8);
  const isizeFromFile = getUint32LE(out, out.length - 4);
  const computed = crc32(original);
  if (crcFromFile !== computed) return false;
  if (isizeFromFile >>> 0 !== original.length >>> 0) return false;
  return true;
}

export async function compress(
  input: Uint8Array | ArrayBuffer | string,
): Promise<Uint8Array> {
  const u8 = toUint8Array(input as any);

  // Try native CompressionStream if available (browser / Bun) and validate
  if (typeof (globalThis as any).CompressionStream !== 'undefined') {
    try {
      const cs = new (globalThis as any).CompressionStream('gzip');
      const writer = cs.writable.getWriter();
      await writer.write(u8);
      await writer.close();
      const ab = await new Response(cs.readable).arrayBuffer();
      const out = new Uint8Array(ab);
      if (validateNativeGzip(out, u8)) return out;
      // else: fall through to JS fallback
    } catch (e) {
       
      console.warn(
        '[wince] compress: native CompressionStream failed, falling back to JS gzipSync',
        e,
      );
      // ignore and fallback
    }
  }

  // Fallback: use fflate's gzipSync
  return gzipSync(u8);
}

export default compress;

/**
 * Synchronously gzip-compress `input` using fflate.
 * Use this on the page-unload path (pagehide) where async is not allowed.
 */
export function compressSync(input: Uint8Array | ArrayBuffer | string): Uint8Array {
  return gzipSync(toUint8Array(input as any));
}

/**
 * Synchronously gunzip `input` using fflate.
 * Use this to decompress events replayed from IndexedDB on startup.
 */
export function decompressSync(input: Uint8Array | ArrayBuffer): Uint8Array {
  return gunzipSync(toUint8Array(input as any));
}
