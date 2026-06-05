import gzip from '../src/gzip';

async function main() {
  const input = 'The quick brown fox jumps over the lazy dog';
  const out = await gzip(input);
  console.log('compressed length:', out.length);
  console.log('gzip header bytes:', out[0].toString(16), out[1].toString(16));
  // show stored ISIZE
  const dv = new DataView(out.buffer, out.byteOffset + out.length - 4, 4);
  console.log('stored original size (ISIZE):', dv.getUint32(0, true));
}

main().catch((e) => {
  console.error('gzip demo error:', e);
  process.exit(1);
});
