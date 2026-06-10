import type { WinceClient } from '../client';
import { useClickCapture } from './_click-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeadClickOptions {
  /**
   * Timeout (ms) after a click to wait for a DOM mutation, scroll, or
   * selection change before declaring it dead. Default: 500.
   */
  timeoutMs?: number;
  /**
   * Ignore clicks on `<a>` elements — the browser handles navigation,
   * so we can't observe the result. Default: true.
   */
  ignoreLinks?: boolean;
  /**
   * Ignore clicks with modifier keys (Ctrl, Shift, Alt, Meta).
   * These typically open links in new tabs/windows — the browser handles
   * navigation, so no observable effect fires in this tab.
   * Default: true.
   */
  ignoreModifierKeys?: boolean;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Dead-click detection plugin.
 *
 * A "dead click" is a click that produces no observable effect: no DOM
 * mutation, no scroll, and no selection change within `timeoutMs` of the
 * click. These typically indicate broken event handlers or UI bugs.
 *
 * Uses the shared `useClickCapture` dispatcher — no extra document click
 * listener. Ancestor `data-track="false"` opt-out is inherited from
 * `sanitizeClick`.
 *
 * @returns A cleanup function that removes all listeners.
 */
export function mountDeadClick(
  tracker: WinceClient,
  options: DeadClickOptions = {},
): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => undefined;
  }

  const timeoutMs          = options?.timeoutMs          ?? 500;
  const ignoreLinks        = options?.ignoreLinks        ?? true;
  const ignoreModifierKeys = options?.ignoreModifierKeys ?? true;

  // ---- pending clicks awaiting an observable effect ----
  interface DeadClickCandidate {
    tag:        string;
    text:       string;
    href?:      string;
    track_id?:  string;
    chain:      string;
    at:         number;
    modifier:   boolean;
  }

  const pending: DeadClickCandidate[] = [];
  let _checkTimer: ReturnType<typeof setTimeout> | undefined;

  function flushSurvivors(): void {
    if (_checkTimer !== undefined) {
      clearTimeout(_checkTimer);
      _checkTimer = undefined;
    }
    // All remaining clicks had no observable effect → dead.
    for (const c of pending) {
      tracker.track('$dead_click', {
        tag:            c.tag,
        text:           c.text,
        href:           c.href,
        track_id:       c.track_id,
        elements_chain: c.chain,
        elapsed_ms:     Date.now() - c.at,
        has_modifier:   c.modifier,
      });
    }
    pending.length = 0;
  }

  function armCheck(): void {
    if (_checkTimer !== undefined) return;
    _checkTimer = setTimeout(flushSurvivors, timeoutMs);
  }

  // ---- observers: any of these clears pending clicks ----

  function clearPending(): void {
    pending.length = 0;
    if (_checkTimer !== undefined) {
      clearTimeout(_checkTimer);
      _checkTimer = undefined;
    }
  }

  const _mutObs = new MutationObserver(clearPending);
  _mutObs.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true, // catches inline text updates (e.g. "Calculating..." → "$3.50")
  });

  let _pendingScroll = false;
  const _onScroll = () => {
    if (_pendingScroll) return;
    _pendingScroll = true;
    requestAnimationFrame(() => {
      _pendingScroll = false;
      clearPending();
    });
  };

  window.addEventListener('scroll', _onScroll, { capture: true, passive: true });
  document.addEventListener('selectionchange', clearPending);

  // ---- click dispatch ----

  const unsub = useClickCapture((data) => {
    // Clear any pending clicks — this new click is itself an observable effect.
    // Clicks within timeoutMs of each other clear the previous batch.
    if (pending.length > 0) clearPending();

    // Modifier keys (Ctrl+Click, Shift+Click) typically open new tabs — the
    // navigation happens in another tab, so this tab sees no mutation.
    if (ignoreModifierKeys && data.hasModifier) return;

    if (ignoreLinks && (data.tag === 'a' || data.href)) return;

    pending.push({
      tag:       data.tag,
      text:      data.text,
      href:      data.href,
      track_id:  data.trackId,
      chain:     data.elements_chain,
      at:        Date.now(),
      modifier:  data.hasModifier,
    });
    armCheck();
  });

  return () => {
    unsub();
    clearPending();
    _mutObs.disconnect();
    window.removeEventListener('scroll', _onScroll, { capture: true });
    document.removeEventListener('selectionchange', clearPending);
  };
}