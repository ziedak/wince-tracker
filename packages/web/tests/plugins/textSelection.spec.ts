/** @jest-environment jsdom */
import { mountTextSelection } from '../../src/plugins/textSelection.js';

function mockSelection(text: string, anchorTag = 'P'): void {
  const anchorEl = document.createElement(anchorTag.toLowerCase());
  const anchorNode = { parentElement: anchorEl };
  const sel: Partial<Selection> = {
    isCollapsed:  false,
    toString:     () => text,
    anchorNode:   anchorNode as unknown as Node,
    getRangeAt:   (() => ({
      commonAncestorContainer: {
        childNodes: [],
      },
    })) as unknown as (index: number) => Range,
  };
  jest.spyOn(document, 'getSelection').mockReturnValue(sel as unknown as Selection);
}

describe('mountTextSelection', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('emits $text_selection with length and tag on pointerup', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountTextSelection(tracker);

    mockSelection('Compare prices here', 'P');
    document.dispatchEvent(new Event('pointerup', { bubbles: true }));

    expect(tracker.track).toHaveBeenCalledWith('$text_selection', expect.objectContaining({
      selected_length:     19,
      context_element_tag: 'p',
      $plugin_source:      'textSelection',
    }));

    // Verify the actual text is NOT captured.
    const call = tracker.track.mock.calls[0][1];
    expect(Object.keys(call)).not.toContain('selected_text');

    cleanup();
  });

  it('emits $text_selection for keyboard selection via selectionchange', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountTextSelection(tracker);

    mockSelection('Keyboard selection', 'SPAN');
    document.dispatchEvent(new Event('selectionchange'));

    expect(tracker.track).toHaveBeenCalledWith('$text_selection', expect.objectContaining({
      selected_length:     18,
      context_element_tag: 'span',
      $plugin_source:      'textSelection',
    }));

    cleanup();
  });

  it('does NOT emit for collapsed (empty) selections', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountTextSelection(tracker);

    jest.spyOn(document, 'getSelection').mockReturnValue({
      isCollapsed: true,
      toString:    () => '',
    } as unknown as Selection);

    document.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(tracker.track).not.toHaveBeenCalled();

    cleanup();
  });

  it('does NOT emit for single-character selections', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountTextSelection(tracker);

    mockSelection('A', 'SPAN');
    document.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(tracker.track).not.toHaveBeenCalled();

    cleanup();
  });

  it('deduplicates consecutive selections of same length+tag+track-id within one gesture', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountTextSelection(tracker);

    mockSelection('Same text again', 'P');
    document.dispatchEvent(new Event('pointerup', { bubbles: true }));
    document.dispatchEvent(new Event('pointerup', { bubbles: true }));

    expect(tracker.track).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('does NOT deduplicate same length+tag across separate gestures', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountTextSelection(tracker);

    // First gesture
    jest.useFakeTimers();
    jest.setSystemTime(1_000);
    mockSelection('hello', 'P');
    document.dispatchEvent(new Event('pointerup', { bubbles: true }));

    // Second gesture — same length, same tag, different selection intent
    jest.setSystemTime(1_500);
    mockSelection('world', 'P');
    document.dispatchEvent(new Event('pointerup', { bubbles: true }));

    expect(tracker.track).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
    cleanup();
  });

  it('emits context_track_id from nearest [data-track] ancestor', () => {
    document.body.innerHTML = `<section data-track="product-desc"><p id="desc">Some price</p></section>`;
    const p = document.getElementById('desc')!;

    const anchorNode = { parentElement: p };
    jest.spyOn(document, 'getSelection').mockReturnValue({
      isCollapsed:  false,
      toString:     () => 'Some price',
      anchorNode:   anchorNode as unknown as Node,
      getRangeAt:   (() => ({
        commonAncestorContainer: {
          childNodes: [],
        },
      })) as unknown as (index: number) => Range,
    } as unknown as Selection);

    const tracker: any = { track: jest.fn() };
    const cleanup = mountTextSelection(tracker);

    document.dispatchEvent(new Event('pointerup', { bubbles: true }));

    expect(tracker.track).toHaveBeenCalledWith('$text_selection', expect.objectContaining({
      context_track_id: 'product-desc',
    }));

    cleanup();
  });
});
