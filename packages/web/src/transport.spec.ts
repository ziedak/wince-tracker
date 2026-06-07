import { createDefaultTransport } from './transport';

describe('createDefaultTransport', () => {
  it('returns an object with send and flush methods', () => {
    const t: any = createDefaultTransport('https://example.com/collect');
    expect(typeof t.send).toBe('function');
    expect(typeof t.flush).toBe('function');
  });
});
