import { ConsentManager, ConsentStatus } from './consent';

// Patch document.cookie via Object.defineProperty
function patchCookie(value: string) {
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => value,
    set: jest.fn(),
  });
}

function restoreCookie() {
  // Remove the override so subsequent tests start clean
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => '',
    set: () => {},
  });
}

describe('ConsentStatus', () => {
  it('has correct values', () => {
    expect(ConsentStatus.PENDING).toBe(-1);
    expect(ConsentStatus.DENIED).toBe(0);
    expect(ConsentStatus.GRANTED).toBe(1);
  });
});

describe('ConsentManager', () => {
  beforeEach(() => restoreCookie());

  it('starts PENDING when no cookie is set', () => {
    const mgr = new ConsentManager();
    expect(mgr.isPending()).toBe(true);
    expect(mgr.getStatus()).toBe(ConsentStatus.PENDING);
  });

  it('reads GRANTED from stored cookie', () => {
    patchCookie('__wince_consent=1');
    const mgr = new ConsentManager();
    expect(mgr.isGranted()).toBe(true);
  });

  it('reads DENIED from stored cookie', () => {
    patchCookie('__wince_consent=0');
    const mgr = new ConsentManager();
    expect(mgr.isDenied()).toBe(true);
  });

  it('optIn() sets status to GRANTED', () => {
    const mgr = new ConsentManager();
    mgr.optIn();
    expect(mgr.isGranted()).toBe(true);
  });

  it('optOut() sets status to DENIED', () => {
    const mgr = new ConsentManager();
    mgr.optOut();
    expect(mgr.isDenied()).toBe(true);
  });

  it('clear() reverts to PENDING', () => {
    const mgr = new ConsentManager();
    mgr.optIn();
    mgr.clear();
    expect(mgr.isPending()).toBe(true);
  });

  it('onChange fires when status changes', () => {
    const mgr = new ConsentManager();
    const cb  = jest.fn();
    mgr.onChange(cb);
    mgr.optIn();
    expect(cb).toHaveBeenCalledWith(ConsentStatus.GRANTED);
  });

  it('onChange does not fire if status is unchanged', () => {
    const mgr = new ConsentManager();
    const cb  = jest.fn();
    mgr.optIn();
    mgr.onChange(cb);
    mgr.optIn(); // already GRANTED
    expect(cb).not.toHaveBeenCalled();
  });

  it('onChange unsubscribe stops callbacks', () => {
    const mgr = new ConsentManager();
    const cb  = jest.fn();
    const off = mgr.onChange(cb);
    off();
    mgr.optIn();
    expect(cb).not.toHaveBeenCalled();
  });

  it('DNT overrides stored GRANTED cookie', () => {
    patchCookie('__wince_consent=1');
    Object.defineProperty(navigator, 'doNotTrack', {
      configurable: true, get: () => '1',
    });
    const mgr = new ConsentManager();
    expect(mgr.isDenied()).toBe(true);
    // restore
    Object.defineProperty(navigator, 'doNotTrack', {
      configurable: true, get: () => null,
    });
  });

  it('listener errors do not crash the manager', () => {
    const mgr = new ConsentManager();
    mgr.onChange(() => { throw new Error('listener crash'); });
    expect(() => mgr.optIn()).not.toThrow();
    expect(mgr.isGranted()).toBe(true);
  });
});
