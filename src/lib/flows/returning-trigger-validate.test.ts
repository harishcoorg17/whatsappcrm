import { describe, expect, it } from 'vitest';
import { validateFlowForActivation } from './validate';

const NODES = [
  { node_key: 'start', node_type: 'start', config: { next_node_key: 'end' } },
  { node_key: 'end', node_type: 'end', config: {} },
];

function triggerIssues(trigger_config: Record<string, unknown>) {
  return validateFlowForActivation(
    {
      name: 'Returning customer',
      trigger_type: 'returning_customer',
      trigger_config,
      entry_node_id: 'start',
    },
    NODES
  ).filter((issue) => issue.scope === 'trigger');
}

describe('validate — returning_customer trigger', () => {
  it('accepts an empty config, which uses the defaults', () => {
    expect(triggerIssues({})).toEqual([]);
  });

  it('accepts a custom gap and booking requirement', () => {
    expect(
      triggerIssues({ min_gap_hours: 6, requires_booking: false })
    ).toEqual([]);
    expect(triggerIssues({ min_gap_hours: 0 })).toEqual([]);
  });

  it.each([
    ['a negative gap', { min_gap_hours: -1 }],
    ['a gap that is not a number', { min_gap_hours: '12' }],
    ['a gap that is not finite', { min_gap_hours: Number.POSITIVE_INFINITY }],
    ['an absurdly long gap', { min_gap_hours: 100000 }],
  ])('rejects %s', (_label, config) => {
    expect(triggerIssues(config)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'error',
          field: 'trigger_config.min_gap_hours',
        }),
      ])
    );
  });

  it('rejects a booking requirement that is not true or false', () => {
    expect(triggerIssues({ requires_booking: 'yes' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'error',
          field: 'trigger_config.requires_booking',
        }),
      ])
    );
  });
});
