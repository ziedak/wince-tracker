import { mountIntervention } from '../intervention';
import type { InterventionEventProps } from '../types';

const BASE_PROPS: InterventionEventProps = {
  intervention_id:   'inv-001',
  intervention_type: 'popup',
  channel:           'in_page',
  trigger_reason:    'exit_intent',
  variant_id:        'variant-a',
  experiment_id:     'exp-123',
  confidence_score:  0.87,
  target_section:    'hero',
};

describe('mountIntervention', () => {
  it('emits $intervention_shown', () => {
    const tracker: any = { track: jest.fn() };
    const inv = mountIntervention(tracker);
    inv.shown(BASE_PROPS);
    expect(tracker.track).toHaveBeenCalledWith('$intervention_shown', expect.objectContaining({
      intervention_id:   'inv-001',
      intervention_type: 'popup',
      $plugin_source:    'intervention',
    }));
  });

  it('emits $intervention_clicked', () => {
    const tracker: any = { track: jest.fn() };
    const inv = mountIntervention(tracker);
    inv.clicked(BASE_PROPS);
    expect(tracker.track).toHaveBeenCalledWith('$intervention_clicked', expect.objectContaining({ intervention_id: 'inv-001' }));
  });

  it('emits $intervention_accepted', () => {
    const tracker: any = { track: jest.fn() };
    const inv = mountIntervention(tracker);
    inv.accepted(BASE_PROPS);
    expect(tracker.track).toHaveBeenCalledWith('$intervention_accepted', expect.objectContaining({ intervention_id: 'inv-001' }));
  });

  it('emits $intervention_dismissed with dismissed_reason', () => {
    const tracker: any = { track: jest.fn() };
    const inv = mountIntervention(tracker);
    inv.dismissed({ ...BASE_PROPS, dismissed_reason: 'close_button' });
    expect(tracker.track).toHaveBeenCalledWith('$intervention_dismissed', expect.objectContaining({
      dismissed_reason: 'close_button',
    }));
  });

  it('emits $intervention_ignored', () => {
    const tracker: any = { track: jest.fn() };
    const inv = mountIntervention(tracker);
    inv.ignored(BASE_PROPS);
    expect(tracker.track).toHaveBeenCalledWith('$intervention_ignored', expect.objectContaining({ intervention_id: 'inv-001' }));
  });

  it('emits $intervention_suppressed with suppressed_reason', () => {
    const tracker: any = { track: jest.fn() };
    const inv = mountIntervention(tracker);
    inv.suppressed({ ...BASE_PROPS, suppressed_reason: 'cooldown_24h' });
    expect(tracker.track).toHaveBeenCalledWith('$intervention_suppressed', expect.objectContaining({
      suppressed_reason: 'cooldown_24h',
    }));
  });

  it('all methods become no-ops after destroy()', () => {
    const tracker: any = { track: jest.fn() };
    const inv = mountIntervention(tracker);
    inv.destroy();

    inv.shown(BASE_PROPS);
    inv.clicked(BASE_PROPS);
    inv.accepted(BASE_PROPS);
    inv.dismissed(BASE_PROPS);
    inv.ignored(BASE_PROPS);
    inv.suppressed({ ...BASE_PROPS, suppressed_reason: 'test' });

    expect(tracker.track).not.toHaveBeenCalled();
  });

  it('forwards confidence_score and experiment_id to every event', () => {
    const tracker: any = { track: jest.fn() };
    const inv = mountIntervention(tracker);
    inv.shown(BASE_PROPS);
    const call = tracker.track.mock.calls[0][1];
    expect(call.confidence_score).toBe(0.87);
    expect(call.experiment_id).toBe('exp-123');
  });
});
