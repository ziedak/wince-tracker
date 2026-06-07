import { compress } from './compress';

describe('compress', () => {
  it('compresses a string to a Uint8Array', async () => {
    const out = await compress('hello world');
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBeGreaterThan(0);
  });
});
