import { mountNetworkQuality } from '../../src/plugins/networkQuality.js';

function mockConnection(props: Record<string, unknown>): { triggerChange: () => void } {
  const listeners: Array<() => void> = [];
  const conn = {
    ...props,
    addEventListener: (_type: string, fn: () => void) => listeners.push(fn),
    removeEventListener: (_type: string, fn: () => void) => {
      const i = listeners.indexOf(fn);
      if (i !== -1) listeners.splice(i, 1);
    },
  };

  Object.defineProperty(navigator, 'connection', {
    writable: true,
    configurable: true,
    value: conn,
  });

  return {
    triggerChange: () => listeners.forEach((fn) => fn()),
  };
}

describe('mountNetworkQuality', () => {
  afterEach(() => {
    // Reset navigator.connection to undefined between tests.
    Object.defineProperty(navigator, 'connection', {
      writable: true,
      configurable: true,
      value: undefined,
    });
    jest.restoreAllMocks();
  });

  it('emits $network_quality on mount with connection details', () => {
    mockConnection({ effectiveType: '4g', downlink: 10, rtt: 50, saveData: false });
    const tracker: any = { track: jest.fn() };
    const cleanup = mountNetworkQuality(tracker);

    expect(tracker.track).toHaveBeenCalledWith('$network_quality', expect.objectContaining({
      effective_type:  '4g',
      downlink_mbps:   10,
      rtt_ms:          50,
      $plugin_source:  'networkQuality',
    }));

    cleanup();
  });

  it('re-emits on connection change', () => {
    const { triggerChange } = mockConnection({ effectiveType: '4g', downlink: 10, rtt: 50 });
    const tracker: any = { track: jest.fn() };
    const cleanup = mountNetworkQuality(tracker);

    expect(tracker.track).toHaveBeenCalledTimes(1);
    triggerChange();
    expect(tracker.track).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it('returns no-op cleanup when Network Information API is unavailable', () => {
    Object.defineProperty(navigator, 'connection', {
      writable: true,
      configurable: true,
      value: undefined,
    });
    const tracker: any = { track: jest.fn() };
    const cleanup = mountNetworkQuality(tracker);

    expect(tracker.track).not.toHaveBeenCalled();
    expect(() => cleanup()).not.toThrow();
  });
});
