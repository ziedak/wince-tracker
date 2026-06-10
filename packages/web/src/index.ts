// Browser SDK entry point — full bundle (all plugins included).

export * from '@wince/core';
export { WinceClient, init } from './client';
export type { WinceConfig, WinceDiagnostics } from './client';
export type { DropReason } from '@wince/transport';
export { createDefaultTransport } from '@wince/transport';

// Tree-shakeable auto-capture plugins (not included in index.lite.ts)
export { mountPageView } from './plugins/pageView';
export type { PageViewOptions } from './plugins/pageView';
export { mountClick } from './plugins/click';
export type { ClickData } from './plugins/click';
export { mountRageClick } from './plugins/rageClick';
export type { RageClickOptions } from './plugins/rageClick';
export { mountCart } from './plugins/cart';
export type { CartEventDetail } from './plugins/cart';
export { mountFormAbandon } from './plugins/formAbandon';
export type { FormAbandonOptions } from './plugins/formAbandon';
export { mountErrorCapture } from './plugins/errorCapture';
export type { ErrorCaptureOptions } from './plugins/errorCapture';

// Interaction insight plugins
export { mountDeadClick } from './plugins/deadClick';
export type { DeadClickOptions } from './plugins/deadClick';
export { mountCopyPaste } from './plugins/copyPaste';
export { mountExitIntent } from './plugins/exitIntent';
export { mountFormInteraction } from './plugins/formInteraction';
export type { FormInteractionOptions } from './plugins/formInteraction';

// Web Worker integration (enrichment + IDB persistence off main thread)
export { WorkerClient, initWithWorker } from './worker/client';
