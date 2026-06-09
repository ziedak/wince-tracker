export function addEventListener(
  element: Window | Document | Element | undefined,
  event: string,
  callback: EventListener,
  options?: AddEventListenerOptions,
): void {
  const { capture = false, passive = true } = options ?? {};

  // This is the only place where we are allowed to call this function
  // because the whole idea is that we should be calling this instead of the built-in one
  element?.addEventListener(event, callback, { capture, passive });
}
