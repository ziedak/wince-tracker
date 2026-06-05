#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { gzipSync } from 'fflate';

function readFileUint8(filePath) {
  const buf = fs.readFileSync(filePath);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function check(filePath, limitBytes) {
  const abs = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(abs)) {
    console.error(`Missing bundle: ${filePath}`);
    return { ok: false, reason: 'missing' };
  }
  const u8 = readFileUint8(abs);
  const gz = gzipSync(u8);
  const size = gz.length;
  console.log(`${filePath}: gzipped ${size} bytes (limit ${limitBytes} bytes)`);
  if (size > limitBytes) return { ok: false, reason: 'over' };
  return { ok: true, size };
}

const targets = [
  { path: 'dist/index.lite.esm.js', limit: 20 * 1024, name: 'lite' },
  { path: 'dist/index.esm.js', limit: 40 * 1024, name: 'full' },
];

let ok = true;
for (const t of targets) {
  const res = check(t.path, t.limit);
  if (!res.ok) {
    ok = false;
    if (res.reason === 'missing') console.error(`Bundle missing: ${t.path}`);
    else console.error(`Size limit exceeded for ${t.name} (${t.path})`);
  }
}

if (!ok) process.exit(1);
