import { gzipSync, gunzipSync } from 'fflate';

function toUint8Array(input: Uint8Array | ArrayBuffer | string | ArrayBufferView): Uint8Array {
  if (typeof input === 'string') return new TextEncoder().encode(input);
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (isTypedArrayView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError('Unsupported input type for gzip');
}

function isTypedArrayView(value: unknown): value is ArrayBufferView & { buffer: ArrayBuffer } {
  return Boolean(value && typeof value === 'object' && 'buffer' in value && 'byteLength' in value);
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

// Typed constructor for native CompressionStream
type CompressionStreamConstructor = new (type: 'gzip') => CompressionStream;

function getCompressionStreamCtor(): CompressionStreamConstructor | null {
  if (typeof globalThis.CompressionStream === 'function') {
    return globalThis.CompressionStream as CompressionStreamConstructor;
  }
  return null;
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

export async function compressAsync(input: Uint8Array | ArrayBuffer | string): Promise<Uint8Array> {
  const u8 = toUint8Array(input);

  // Try native CompressionStream if available (browser / Bun) and validate
  const CompressionStreamCtor = getCompressionStreamCtor();
  if (CompressionStreamCtor) {
    try {
      const cs = new CompressionStreamCtor('gzip');
      const writer = cs.writable.getWriter();
      await writer.write(u8 as BufferSource);
      await writer.close();
      const ab = await new Response(cs.readable).arrayBuffer();
      const out = new Uint8Array(ab);
      if (validateNativeGzip(out, u8)) return out;
      // else: fall through to JS fallback
    } catch (e) {
      console.warn(
        '[wince] compress: native CompressionStream failed, falling back to JS gzipSync',
        e
      );
      // ignore and fallback
    }
  }

  // Fallback: use fflate's gzipSync
  return gzipSync(u8);
}

/**
 * Asynchronously gunzip `input` using the native DecompressionStream when available,
 * otherwise falls back to fflate's `gunzipSync`.
 */
export async function decompressAsync(input: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  // Try native DecompressionStream if available
  if (typeof globalThis.DecompressionStream === 'function') {
    try {
      const ds = new globalThis.DecompressionStream('gzip');
      const writer = ds.writable.getWriter();
      await writer.write(input as BufferSource);
      await writer.close();
      const ab = await new Response(ds.readable).arrayBuffer();
      return new Uint8Array(ab);
    } catch (e) {
      console.warn(
        '[wince] decompress: native DecompressionStream failed, falling back to JS gunzipSync',
        e
      );
      // ignore and fallback
    }
  }

  // Fallback: use fflate's gunzipSync
  return gunzipSync(toUint8Array(input));
}


/**
 * Synchronously gzip-compress `input` using fflate.
 * Use this on the page-unload path (pagehide) where async is not allowed.
 */
export function gzipCompressSync(input: Uint8Array | ArrayBuffer | string): Uint8Array {
  return gzipSync(toUint8Array(input));
}

/**
 * Synchronously gunzip `input` using fflate.
 * Use this to decompress events replayed from IndexedDB on startup.
 */
export function gzipDecompressSync(input: Uint8Array | ArrayBuffer): Uint8Array {
  return gunzipSync(toUint8Array(input));
}
