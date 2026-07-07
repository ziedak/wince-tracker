export enum pluginSource {
  Backtrack = 'backtrack',
  Cart = 'cart',
  Click = 'click',
  CopyPaste = 'copyPaste',
  DeadClick = 'deadClick',
  DoubleSubmit = 'doubleSubmit',
  ElementVisibility = 'elementVisibility',
  ErrorCapture = 'errorCapture',
  ExitIntent = 'exitIntent',
  FormAbandon = 'formAbandon',
  FormInteraction = 'formInteraction',
  Intervention = 'intervention',
  NetworkQuality = 'networkQuality',
  PageView = 'pageView',
  Performance = 'performance',
  RageClick = 'rageClick',
  TabFocus = 'tabFocus',
  TabIdle = 'tabIdle',
  ValidationError = 'validationError',
}

export type BacktrackType = {
  from_path: string;
  to_path: string;
  $plugin_source: pluginSource.Backtrack;
};

export type CartCheckoutAbandonType = {
  last_step: string | undefined;
  cart_value_total: number | undefined;
  time_spent_seconds: number;
  trigger: string;
  $plugin_source: pluginSource.Cart;
};
export interface CartEventDetail {
  /** The cart action. */
  action:
    | 'add'
    | 'remove'
    | 'update'
    | 'checkout_start'
    | 'checkout_complete'
    | 'view_cart'
    | 'product_view'
    | 'checkout_step'
    | 'checkout_abandon'
    | 'purchase'
    | 'option_selected'
    | 'coupon_applied'
    | 'coupon_failed';
  product_id?: string;
  name?: string;
  variant_id?: string;
  quantity?: number;
  price?: number;
  currency?: string;
  cart_id?: string;
  /** Total cart value including all items. */
  cart_value_total?: number;
  /** Number of distinct items in the cart. */
  item_count?: number;
  /** Applied coupon code, if any. */
  coupon_code?: string;
  /** Final order ID — used with `purchase` action. */
  order_id?: string;
  /** Final order revenue — used with `purchase` action. */
  revenue?: number;
  /** Product category — used with `product_view` and `add`. */
  category?: string;
  /** Whether the product is in stock — used with `product_view`. */
  stock_status?: 'in_stock' | 'out_of_stock' | 'low_stock';
  /** Checkout step index — used with `checkout_step` action. */
  step?: number;
  /** Human-readable step label — e.g. `'shipping'`, `'payment'`. */
  step_name?: string;
  /** Option name — used with `option_selected`. e.g. `'color'`, `'size'`. */
  option_name?: string;
  /** Option value — used with `option_selected`. e.g. `'red'`, `'XL'`. */
  option_value?: string;
  /** Coupon code attempted — used with `coupon_applied` and `coupon_failed`. */
  code_attempted?: string;
  /** Rejection reason — used with `coupon_failed`. e.g. `'expired'`, `'invalid'`. */
  failure_reason?: string;
  /** Any additional properties are forwarded as-is. */
  [key: string]: unknown;
}
export type CartActionType = Omit<CartEventDetail, 'action'> & {
  time_on_step_ms?: number;
  $plugin_source: pluginSource.Cart;
};

export type ClickType = {
  tag: string;
  text: string;
  elements_chain: string;
  href?: string;
  track_id?: string;
  has_modifier?: boolean;
  label?: string;
  hesitation_ms?: number;
  $plugin_source: pluginSource.Click;
  attrs?: Record<string, unknown>;
};

export type CopyPasteType = {
  tag: string;
  text: string;
  href?: string;
  $plugin_source: pluginSource.CopyPaste;
};

export type DeadClickType = {
  tag: string;
  text: string;
  href?: string;
  track_id?: string;
  elements_chain: string;
  elapsed_ms: number;
  has_modifier: boolean;
  $plugin_source: pluginSource.DeadClick;
};

export type DoubleSubmitType = {
  form_id?: string | undefined;
  form_action?: string | undefined;
  interval_ms?: number | undefined;
  $plugin_source: pluginSource.DoubleSubmit;
};

export type ElementVisibilityType = {
  element_id: string | undefined;
  element_tag: string;
  visible_ms: number;
  max_visible_ratio: number;
  $plugin_source: pluginSource.ElementVisibility;
};

export type ErrorCaptureType = {
  type: 'uncaught' | 'unhandled_rejection';
  message: string;
  source?: string;
  lineno?: number;
  colno?: number;
  stack?: string;
  $plugin_source: pluginSource.ErrorCapture;
};

export type ExitIntentType = {
  page: string;
  $plugin_source: pluginSource.ExitIntent;
};
export type FormAbandonType = {
  form_id: string | undefined;
  form_name?: string;
  form_action?: string;
  fields_filled?: string[];
  field_count?: number;
  $plugin_source: pluginSource.FormAbandon;
};
export type FormInteractionType = {
  form_id: string | undefined;
  form_name?: string;
  form_action?: string;
  field_name: string;
  field_type: string;
  dwell_ms?: number;
  focus_blur_count?: number;
  $plugin_source: pluginSource.FormInteraction;
};

/**
 * Properties attached to every intervention event.
 * All fields are forwarded to the AI model for closed-loop learning.
 */
export type InterventionEventProps = {
  /** Stable unique ID for this specific intervention instance. */
  intervention_id: string;
  /**
   * The type of intervention shown.
   * @example `'popup'`, `'chatbot'`, `'price_reduction'`, `'email_capture'`
   */
  intervention_type: string;
  /**
   * Delivery channel.
   * @example `'in_page'`, `'sms'`, `'email'`, `'push'`
   */
  channel?: string;
  /** The signal that caused the intervention to fire. */
  trigger_reason?: string;
  /** A/B test variant identifier. */
  variant_id?: string;
  /** Experiment the variant belongs to. */
  experiment_id?: string;
  /** Model confidence score (0–1) at the time of intervention decision. */
  confidence_score?: number;
  /** Page section or slot the intervention targeted. */
  target_section?: string;
  /**
   * Suppression bucket that would have blocked this intervention
   * (used with `suppressed()` to explain why it was skipped).
   */
  cooldown_bucket?: string;
};

export type InterventionType = InterventionEventProps & {
  $plugin_source: pluginSource.Intervention;
};

export type NetworkQualityType = {
  effective_type?: string;
  downlink_mbps?: number;
  rtt_ms?: number;
  save_data?: boolean;
  $plugin_source: pluginSource.NetworkQuality;
};

export type PageViewProps = {
  scroll_depth_pct?: number;
  max_scroll_depth_pct?: number;
  scroll_px?: number;
  max_scroll_px?: number;
  content_height_px?: number;
  scroll_direction_changes?: number;
  scroll_max_velocity?: number;
  resize_count?: number;
  viewport_width_px?: number;
  viewport_height_px?: number;
  visible_time_ms?: number;
  time_on_page_ms?: number;
  session_duration_ms?: number;
};

export const utmKeys = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const;
export type UtmProps = {
  [K in (typeof utmKeys)[number]]?: string;
};
export type PageProps = UtmProps & {
  device_type: 'mobile' | 'tablet' | 'desktop';
  screen_width_px: number;
  screen_height_px: number;
  referrer_type: string;
};
export type NavProps = {
  navigation_type: NavigationTimingType;
  $session_resume?: boolean;
};
export type NavPageProps = UtmProps & PageProps;

export type PageViewType = PageViewProps &
  NavPageProps & {
    $plugin_source: pluginSource.PageView;
  };
export type ScrollDepthType = {
  depth_pct: number;
  $plugin_source: pluginSource.PageView;
};
export type PerformanceType = {
  lcp_ms?: number;
  cls_score?: number;
  inp_ms?: number;
  fcp_ms?: number;
  ttfb_ms?: number;
  dom_content_loaded_ms?: number;
  load_ms?: number;
  $plugin_source: pluginSource.Performance;
};

export type RageClickType = {
  tag: string;
  text: string;
  elements_chain: string;
  count: number;
  first_at: number;
  track_id?: string;
  href?: string;
  attrs?: Record<string, unknown>;
  $plugin_source: pluginSource.RageClick;
};

export type TabFocusType =
  | {
      blurred_at: number;
      $plugin_source: pluginSource.TabFocus;
    }
  | {
      away_duration_ms?: number;
      $plugin_source: pluginSource.TabFocus;
    }
  | {
      blur_count: number;
      away_ms: number;
      focused_ms: number;
      window_ms: number;
      reason: 'interval' | 'pagehide';
      $plugin_source: pluginSource.TabFocus;
    };
export type TabIdleType = {
  idle_ms: number;
  $plugin_source: pluginSource.TabIdle;
};
export type TextSelectionType = {
  tag: string;
  text: string;
  elements_chain: string;
  selected_length: number;
  context_element_tag: string;
  href?: string;
  context_track_id?: string;
  $plugin_source: pluginSource.CopyPaste;
};

export type ValidationErrorType = {
  field_name: string;
  field_type: string;
  form_id?: string;
  validation_message?: string;
  $plugin_source: pluginSource.ValidationError;
};