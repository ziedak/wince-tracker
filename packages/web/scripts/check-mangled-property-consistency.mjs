#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkgRoot = path.resolve(__dirname, '..');
const whitelistPath = path.join(pkgRoot, 'mangled-whitelist.json');
const outPath = path.join(pkgRoot, 'src', 'mangled-names.generated.ts');

function readWhitelist() {
  const raw = fs.readFileSync(whitelistPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error('Unable to parse mangled-whitelist.json');
    process.exit(1);
  }
  if (!Array.isArray(parsed)) {
    console.error('mangled-whitelist.json must be an array of strings');
    process.exit(1);
  }
  return [...new Set(parsed.map(String))].sort();
}

function parseGenerated() {
  if (!fs.existsSync(outPath)) {
    console.error('Generated mapping not found. Run generate-mangled first.');
    process.exit(2);
  }
  const raw = fs.readFileSync(outPath, 'utf8');
  const m = raw.match(/export default\s+([\s\S]*);/);
  if (!m) {
    console.error('Unable to parse generated mapping file');
    process.exit(1);
  }
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    console.error('Generated mapping contains invalid JSON');
    process.exit(1);
  }
}

// deterministic encode copied from generator
const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const base = alphabet.length;
function encode(n) {
  if (n === 0) return alphabet[0];
  let s = '';
  while (n > 0) {
    s = alphabet[n % base] + s;
    n = Math.floor(n / base);
  }
  return s;
}

function buildMapping(keys) {
  const mapping = {};
  for (let i = 0; i < keys.length; i++) mapping[keys[i]] = encode(i);
  return mapping;
}

const keys = readWhitelist();
const expected = buildMapping(keys);
const generated = parseGenerated();

if (JSON.stringify(expected) !== JSON.stringify(generated)) {
  console.error('mangled-names.generated.ts is out of date with mangled-whitelist.json');
  process.exit(1);
}

console.log('mangled mapping is consistent');
