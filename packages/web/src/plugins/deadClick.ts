import type { WinceClient } from '../client';
import { useBroadCapture } from './_click-utils';

export interface DeadClickOptions {
  timeoutMs?: number;
  ignoreLinks?: boolean;
  ignoreModifierKeys?: boolean;
}

export function mountDeadClick(
  tracker: WinceClient,
  options: DeadClickOptions = {},
): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => undefined;
  }

  const timeoutMs          = options?.timeoutMs          ?? 500;
  const ignoreLinks        = options?.ignoreLinks        ?? false;
  const ignoreModifierKeys = options?.ignoreModifierKeys ?? true;

  interface DeadClickCandidate {
    tag:       string;
    text:      string;
    href?:     string;
    track_id?: string;
    chain:     string;
    at:        number;
    modifier:  boolean;
  }

  const pending: DeadClickCandidate[] = [];
  let _checkTimer: ReturnType<typeof setTimeout> | undefined;

  function flushSurvivors(): void {
    if (_checkTimer !== undefined) {
      clearTimeout(_checkTimer);
      _checkTimer = undefined;
    }
    for (const c of pending) {
      tracker.track('$dead_click', {
        tag:            c.tag,
        text:           c.text,
        href:           c.href,
        track_id:       c.track_id,
        elements_chain: c.chain,
        elapsed_ms:     Date.now() - c.at,
        has_modifier:   c.modifier,
        $plugin_source: 'deadClick',
      });
    }
    pending.length = 0;
  }

  function armCheck(): void {
    if (_checkTimer !== undefined) return;
    _checkTimer = setTimeout(flushSurvivors, timeoutMs);
  }

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
    characterData: true,
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

  const unsub = useBroadCapture((data) => {
    if (ignoreModifierKeys && data.hasModifier) return;
    if (ignoreLinks && (data.tag === 'a' || data.href)) return;

    pending.push({
      tag:      data.tag,
      text:     data.text,
      href:     data.href,
      track_id: data.trackId,
      chain:    data.elements_chain,
      at:       Date.now(),
      modifier: data.hasModifier,
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
