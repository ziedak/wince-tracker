import type { WinceClient } from '../client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Properties attached to every intervention event.
 * All fields are forwarded to the AI model for closed-loop learning.
 */
export interface InterventionEventProps {
  /** Stable unique ID for this specific intervention instance. */
  intervention_id:    string;
  /**
   * The type of intervention shown.
   * @example `'popup'`, `'chatbot'`, `'price_reduction'`, `'email_capture'`
   */
  intervention_type:  string;
  /**
   * Delivery channel.
   * @example `'in_page'`, `'sms'`, `'email'`, `'push'`
   */
  channel?:           string;
  /** The signal that caused the intervention to fire. */
  trigger_reason?:    string;
  /** A/B test variant identifier. */
  variant_id?:        string;
  /** Experiment the variant belongs to. */
  experiment_id?:     string;
  /** Model confidence score (0–1) at the time of intervention decision. */
  confidence_score?:  number;
  /** Page section or slot the intervention targeted. */
  target_section?:    string;
  /**
   * Suppression bucket that would have blocked this intervention
   * (used with `suppressed()` to explain why it was skipped).
   */
  cooldown_bucket?:   string;
}

/**
 * Object returned by `mountIntervention`. Call its methods whenever the
 * application shows, dismisses, or responds to an intervention. Call
 * `destroy()` when the intervention surface is unmounted.
 */
export interface InterventionTracker {
  /** Intervention was displayed to the user. */
  shown(props: InterventionEventProps): void;
  /** User actively closed or swiped away the intervention. */
  dismissed(props: InterventionEventProps & { dismissed_reason?: string }): void;
  /** User clicked a CTA inside the intervention. */
  clicked(props: InterventionEventProps): void;
  /** User completed the desired action (e.g. applied coupon, subscribed). */
  accepted(props: InterventionEventProps): void;
  /** Intervention was shown but user took no action within the dwell window. */
  ignored(props: InterventionEventProps): void;
  /**
   * Intervention was NOT shown because a suppression rule blocked it.
   * Use this to keep the model informed of what it would have shown.
   */
  suppressed(props: InterventionEventProps & { suppressed_reason: string }): void;
  /**
   * Tear down this tracker. All subsequent method calls become no-ops.
   * Call this when the intervention surface unmounts.
   */
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Intervention feedback loop plugin.
 *
 * Returns an `InterventionTracker` object — not a bare cleanup function —
 * because the intervention lifecycle requires multiple named methods.
 *
 * This plugin is the most important addition to the tracker for closing
 * the AI training loop. Without it the model fires interventions but never
 * learns which ones worked, on which users, at which funnel stage, or
 * through which channel.
 *
 * @example
 * ```ts
 * const interventions = mountIntervention(tracker);
 *
 * // When your discount popup appears:
 * interventions.shown({
 *   intervention_id:   'inv_01J...',
 *   intervention_type: 'popup',
 *   channel:           'in_page',
 *   trigger_reason:    'exit_intent',
 *   variant_id:        'discount_10pct',
 *   confidence_score:  0.82,
 * });
 *
 * // If the user clicks the CTA:
 * interventions.clicked({ intervention_id: 'inv_01J...', intervention_type: 'popup' });
 *
 * // On component unmount:
 * interventions.destroy();
 * ```
 */
export function mountIntervention(tracker: WinceClient): InterventionTracker {
  let _destroyed = false;

  function emit(event: string, props: InterventionEventProps): void {
    if (_destroyed) return;
    tracker.track(event, {
      ...props,
      $plugin_source: 'intervention',
    } as Record<string, unknown>);
  }

  return {
    shown:      (props) => emit('$intervention_shown', props),
    dismissed:  (props) => emit('$intervention_dismissed', props),
    clicked:    (props) => emit('$intervention_clicked', props),
    accepted:   (props) => emit('$intervention_accepted', props),
    ignored:    (props) => emit('$intervention_ignored', props),
    suppressed: (props) => emit('$intervention_suppressed', props),
    destroy() { _destroyed = true; },
  };
}
