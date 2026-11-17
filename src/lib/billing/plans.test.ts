import { describe, expect, it } from 'vitest';
import {
  canAddAgent,
  canAddNumber,
  canUseFeature,
  normalizePlan,
  quotePrice,
  resolveLimits,
  trialDaysLeft,
} from './plans';

const NOW = new Date('2026-06-01T00:00:00Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const active = (plan: string, extraAgents = 0) =>
  resolveLimits(
    { plan, status: 'active', trialEndsAt: null, extraAgents },
    NOW
  );

describe('resolveLimits', () => {
  it('gives a running trial Growth limits whatever the plan column says', () => {
    const limits = resolveLimits(
      { plan: 'starter', status: 'trialing', trialEndsAt: inDays(9) },
      NOW
    );
    expect(limits).toMatchObject({
      plan: 'growth',
      agents: 5,
      numbers: 2,
      isTrialing: true,
      isLocked: false,
      trialDaysLeft: 9,
    });
    expect(canUseFeature(limits, 'flows')).toBe(true);
  });

  it('locks to Starter once the trial has ended', () => {
    const limits = resolveLimits(
      { plan: 'growth', status: 'trialing', trialEndsAt: inDays(-1) },
      NOW
    );
    expect(limits).toMatchObject({ plan: 'starter', isLocked: true });
    expect(canUseFeature(limits, 'pipelines')).toBe(false);
  });

  it('applies the paid plan when active', () => {
    expect(active('starter')).toMatchObject({ agents: 3, numbers: 1 });
    expect(active('growth')).toMatchObject({ agents: 5, numbers: 2 });
  });

  it('adds paid extra agents on top of the plan', () => {
    expect(active('starter', 2).agents).toBe(5);
  });

  it('keeps access while a payment is being retried (past_due)', () => {
    const limits = resolveLimits(
      { plan: 'growth', status: 'past_due', trialEndsAt: null },
      NOW
    );
    expect(limits).toMatchObject({ plan: 'growth', isLocked: false });
  });

  it('locks canceled and expired subscriptions', () => {
    for (const status of ['canceled', 'expired']) {
      expect(
        resolveLimits({ plan: 'growth', status, trialEndsAt: null }, NOW)
          .isLocked
      ).toBe(true);
    }
  });

  it('treats Scale (and legacy enterprise) as unlimited', () => {
    expect(active('scale')).toMatchObject({ agents: null, numbers: null });
    expect(active('enterprise').plan).toBe('scale');
  });

  it('defaults a missing status to trialing', () => {
    expect(
      resolveLimits({ plan: null, status: null, trialEndsAt: inDays(3) }, NOW)
        .isTrialing
    ).toBe(true);
  });
});

describe('canAddAgent / canAddNumber', () => {
  it('allows up to the limit and blocks at it', () => {
    const starter = active('starter');
    expect(canAddAgent(starter, 2).allowed).toBe(true);
    const blocked = canAddAgent(starter, 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.message).toContain('Starter plan includes 3 agents');
  });

  it('uses singular wording for one number', () => {
    const result = canAddNumber(active('starter'), 1);
    expect(result.allowed).toBe(false);
    expect(result.message).toContain('1 WhatsApp number.');
  });

  it('never blocks an unlimited plan', () => {
    expect(canAddAgent(active('scale'), 500).allowed).toBe(true);
    expect(canAddNumber(active('scale'), 500).allowed).toBe(true);
  });

  it('says the trial ended when locked', () => {
    const locked = resolveLimits(
      { plan: 'growth', status: 'expired', trialEndsAt: null },
      NOW
    );
    expect(canAddAgent(locked, 3).message).toMatch(/trial has ended/i);
  });
});

describe('canUseFeature', () => {
  it('gates flows, handoff and pipelines to Growth and Scale', () => {
    for (const feature of ['flows', 'humanHandoff', 'pipelines'] as const) {
      expect(canUseFeature(active('starter'), feature)).toBe(false);
      expect(canUseFeature(active('growth'), feature)).toBe(true);
      expect(canUseFeature(active('scale'), feature)).toBe(true);
    }
  });
});

describe('quotePrice', () => {
  it('adds 18% GST to a monthly price', () => {
    expect(quotePrice('starter', 'monthly')).toEqual({
      subtotalPaise: 199_900,
      gstPaise: 35_982,
      totalPaise: 235_882,
      monthsCharged: 1,
    });
  });

  it('charges ten months for a year', () => {
    expect(quotePrice('growth', 'yearly')).toMatchObject({
      subtotalPaise: 4_999_000,
      monthsCharged: 10,
    });
  });

  it('has no price for custom plans', () => {
    expect(quotePrice('scale', 'monthly')).toBeNull();
  });
});

describe('helpers', () => {
  it('normalizes unknown plans to starter', () => {
    expect(normalizePlan('weird')).toBe('starter');
    expect(normalizePlan(null)).toBe('starter');
  });

  it('rounds partial trial days up and never goes negative', () => {
    expect(trialDaysLeft(new Date(NOW.getTime() + 3_600_000), NOW)).toBe(1);
    expect(trialDaysLeft(inDays(-5), NOW)).toBe(0);
    expect(trialDaysLeft(null, NOW)).toBe(0);
  });
});
