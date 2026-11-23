import { describe, it, expect } from 'vitest';
import {
  computeDepositSettlement,
  depositSettlementFromSnapshot,
  settleFromDepositEnabled,
} from './deposit-settlement';

describe('computeDepositSettlement', () => {
  it('deposit covers the bill: applies the full bill, keeps the rest in trust', () => {
    expect(computeDepositSettlement(45_000, 120_000)).toEqual({ applied: 45_000, remaining: 75_000 });
  });

  it('deposit falls short: applies the whole deposit, nothing remains', () => {
    expect(computeDepositSettlement(45_000, 30_000)).toEqual({ applied: 30_000, remaining: 0 });
  });

  it('exact cover exhausts the deposit', () => {
    expect(computeDepositSettlement(45_000, 45_000)).toEqual({ applied: 45_000, remaining: 0 });
  });

  it('returns null when there is no deposit', () => {
    expect(computeDepositSettlement(45_000, 0)).toBeNull();
    expect(computeDepositSettlement(45_000, -5)).toBeNull();
  });

  it('returns null when nothing is due', () => {
    expect(computeDepositSettlement(0, 50_000)).toBeNull();
    expect(computeDepositSettlement(-100, 50_000)).toBeNull();
  });

  it('ignores sub-centavo dust on either side', () => {
    expect(computeDepositSettlement(0.004, 50_000)).toBeNull();
    expect(computeDepositSettlement(50_000, 0.004)).toBeNull();
  });

  it('rounds to centavos', () => {
    const s = computeDepositSettlement(1000.555, 2000.111);
    expect(s).toEqual({ applied: 1000.56, remaining: 999.55 });
  });

  it('tolerates non-numeric input without NaN', () => {
    expect(computeDepositSettlement(Number('x'), 100)).toBeNull();
    expect(computeDepositSettlement(100, Number('x'))).toBeNull();
  });
});

describe('settleFromDepositEnabled', () => {
  it('accepts boolean true and the string "true" (matter-config JSONB shape)', () => {
    expect(settleFromDepositEnabled(true)).toBe(true);
    expect(settleFromDepositEnabled('true')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(settleFromDepositEnabled(false)).toBe(false);
    expect(settleFromDepositEnabled('false')).toBe(false);
    expect(settleFromDepositEnabled(undefined)).toBe(false);
    expect(settleFromDepositEnabled(1)).toBe(false);
  });
});

describe('depositSettlementFromSnapshot', () => {
  it('reads the frozen figures from a settle-from-deposit snapshot', () => {
    expect(depositSettlementFromSnapshot({
      settleFromDeposit: true,
      depositApplied: 45_000,
      depositRemaining: 75_000,
    })).toEqual({ applied: 45_000, remaining: 75_000 });
  });

  it('returns null when the setting is off, even if figures linger', () => {
    expect(depositSettlementFromSnapshot({
      settleFromDeposit: false,
      depositApplied: 45_000,
    })).toBeNull();
  });

  it('returns null without a positive applied figure', () => {
    expect(depositSettlementFromSnapshot({ settleFromDeposit: true })).toBeNull();
    expect(depositSettlementFromSnapshot({ settleFromDeposit: true, depositApplied: 0 })).toBeNull();
  });

  it('returns null for a missing snapshot', () => {
    expect(depositSettlementFromSnapshot(null)).toBeNull();
    expect(depositSettlementFromSnapshot(undefined)).toBeNull();
  });

  it('defaults remaining to 0 when the snapshot lacks it', () => {
    expect(depositSettlementFromSnapshot({
      settleFromDeposit: true,
      depositApplied: 10_000,
    })).toEqual({ applied: 10_000, remaining: 0 });
  });
});
