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
export { mountRageClick } from './plugins/rageClick';
export type { RageClickOptions } from './plugins/rageClick';
export { mountCart } from './plugins/cart';
export type { CartOptions } from './plugins/cart';
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

// Visibility & behavioral signal plugins
export { mountElementVisibility } from './plugins/elementVisibility';
export type { ElementVisibilityOptions } from './plugins/elementVisibility';
export { mountTabFocus } from './plugins/tabFocus';
export type { TabFocusOptions } from './plugins/tabFocus';
export { mountTabIdle } from './plugins/tabIdle';
export type { TabIdleOptions } from './plugins/tabIdle';
export { mountTextSelection } from './plugins/textSelection';
export { mountNetworkQuality } from './plugins/networkQuality';
export { mountPerformance } from './plugins/performance';
export type { PerformanceOptions } from './plugins/performance';

// Form friction signal plugins
export { mountValidationError } from './plugins/validationError';
export { mountDoubleSubmit } from './plugins/doubleSubmit';
export type { DoubleSubmitOptions } from './plugins/doubleSubmit';
export { mountBacktrack } from './plugins/backtrack';

// Intervention feedback loop
export { mountIntervention } from './plugins/intervention';
export type { InterventionTracker } from './plugins/intervention';

// Web Worker integration (enrichment + IDB persistence off main thread)
export { WorkerClient, initWithWorker } from './worker/client';
export * from './plugins/types';
