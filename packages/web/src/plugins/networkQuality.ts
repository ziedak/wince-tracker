import type { WinceClient } from '../client';

// The Network Information API is non-standard and absent in Firefox/Safari.
// All access is guarded by feature detection and wrapped in try/catch.
interface NetworkInformation extends EventTarget {
  readonly effectiveType?: 'slow-2g' | '2g' | '3g' | '4g';
  readonly downlink?:      number;   // Mbps
  readonly rtt?:           number;   // ms
  readonly saveData?:      boolean;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

function getConnection(): NetworkInformation | undefined {
  try {
    const nav = navigator as Navigator & {
      connection?:       NetworkInformation;
      mozConnection?:    NetworkInformation;
      webkitConnection?: NetworkInformation;
    };
    return nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
  } catch {
    return undefined;
  }
}

/**
 * Network quality plugin.
 *
 * Emits `$network_quality` once on mount with the user's current network
 * conditions, then re-emits whenever the connection changes.
 *
 * Relevant for intervention timing: avoid showing large-asset popups (video,
 * animated banners) to users on `slow-2g`; prioritise SMS over in-page
 * modals for high-latency connections.
 *
 * Uses the Network Information API (Chrome/Edge only — gracefully absent
 * in Firefox and Safari).
 *
 * @returns A cleanup function that removes the change listener.
 */
export function mountNetworkQuality(tracker: WinceClient): () => void {
  if (typeof navigator === 'undefined') return () => undefined;

  const conn = getConnection();
  if (!conn) return () => undefined;

  function emit(): void {
    try {
      const props: Record<string, unknown> = { $plugin_source: 'networkQuality' };
      if (conn!.effectiveType !== undefined) props['effective_type'] = conn!.effectiveType;
      if (conn!.downlink      !== undefined) props['downlink_mbps']  = conn!.downlink;
      if (conn!.rtt           !== undefined) props['rtt_ms']         = conn!.rtt;
      if (conn!.saveData      !== undefined) props['save_data']      = conn!.saveData;
      tracker.track('$network_quality', props);
    } catch {
      // API may throw on restricted origins — fail silently.
    }
  }

  emit();
  conn.addEventListener('change', emit);

  return () => conn.removeEventListener('change', emit);
}
