// import { EventPriority } from "@wince/types";

/**
 * Person-level traits that can accompany any event or identify call.
 * Passed through to the backend without client-side processing.
 */
export interface PersonProps {
  $set?:      Record<string, unknown>;
  $set_once?: Record<string, unknown>;
}

// /**
//  * Contextual fields that the SDK enriches onto every event.
//  * Passed from session + identity managers into the pipeline.
//  */
// export interface EventContext {
//   sid: string;
//   anon: string;
//   uid?: string;
//   seq: number;
//   url?: string;
//   ref?: string;
// }



// /**
//  * Optional delivery options passed to `tracker.track()` as the fourth argument.
//  */
// export interface TrackOptions {
//   /**
//    * Delivery priority.
//    * - `'critical'` — sent immediately via a dedicated single-event flush (no batching).
//    * - `'high'`     — flushed in small batches every 2 s.
//    * - `'normal'`   — flushed in larger batches every 5 s (default).
//    */
//   priority?: EventPriority;
// }


