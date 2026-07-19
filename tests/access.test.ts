import { describe, expect, it } from 'vitest';
import {
  daysRemaining,
  evaluateAccess,
  shouldExpire,
  trialEndsAtFrom,
  TRIAL_DAYS,
  type AccessSubject,
} from '@/lib/access/policy';
import { evaluateDevice, hashDeviceId } from '@/lib/access/device';

const NOW = new Date('2026-07-19T12:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const subject = (over: Partial<AccessSubject> = {}): AccessSubject => ({
  planStatus: 'TRIAL',
  trialEndsAt: day(3),
  ...over,
});

describe('trial window', () => {
  it('defaults to a 7-day trial', () => {
    expect(TRIAL_DAYS).toBe(7);
    expect(trialEndsAtFrom(NOW).toISOString()).toBe('2026-07-26T12:00:00.000Z');
  });

  it('supports a custom length for manual extension', () => {
    expect(trialEndsAtFrom(NOW, 14).toISOString()).toBe('2026-08-02T12:00:00.000Z');
  });

  it('counts whole days remaining and floors at zero', () => {
    expect(daysRemaining(day(3), NOW)).toBe(3);
    expect(daysRemaining(day(-1), NOW)).toBe(0);
    expect(daysRemaining(null, NOW)).toBeNull();
  });
});

describe('evaluateAccess — trial', () => {
  it('ALLOWS a trial with time left', () => {
    const d = evaluateAccess(subject(), NOW);
    expect(d.allowed).toBe(true);
    expect(d.code).toBe('OK');
    expect(d.daysLeft).toBe(3);
    expect(d.message).toMatch(/3 days remaining/);
  });

  it('BLOCKS once the trial window has passed', () => {
    const d = evaluateAccess(subject({ trialEndsAt: day(-1) }), NOW);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('TRIAL_EXPIRED');
    expect(d.message).toMatch(/trial ended/i);
  });

  it('includes the support contact in the blocked message', () => {
    const d = evaluateAccess(subject({ trialEndsAt: day(-1) }), NOW, {
      supportContact: 'owner@example.com',
    });
    expect(d.message).toContain('owner@example.com');
  });

  it('falls back to a generic contact line when none is configured', () => {
    const d = evaluateAccess(subject({ trialEndsAt: day(-1) }), NOW);
    expect(d.message).toMatch(/contact the administrator/i);
    // Still specific about WHY — never a generic error.
    expect(d.message).toMatch(/trial/i);
  });

  it('allows a trial with no end date rather than locking someone out', () => {
    expect(evaluateAccess(subject({ trialEndsAt: null }), NOW).allowed).toBe(true);
  });
});

describe('evaluateAccess — other statuses', () => {
  it('ACTIVE bypasses the trial clock entirely', () => {
    const d = evaluateAccess(
      subject({ planStatus: 'ACTIVE', trialEndsAt: day(-100) }),
      NOW,
    );
    expect(d.allowed).toBe(true);
    expect(d.code).toBe('OK');
  });

  it('EXPIRED blocks', () => {
    const d = evaluateAccess(subject({ planStatus: 'EXPIRED' }), NOW);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('TRIAL_EXPIRED');
  });

  it('DISABLED blocks with the device-lock message, not a trial message', () => {
    const d = evaluateAccess(subject({ planStatus: 'DISABLED' }), NOW);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('DEVICE_LOCKED');
    expect(d.message).toMatch(/another device/i);
    expect(d.message).not.toMatch(/trial/i);
  });

  it('DISABLED blocks even with trial time remaining', () => {
    const d = evaluateAccess(
      subject({ planStatus: 'DISABLED', trialEndsAt: day(30) }),
      NOW,
    );
    expect(d.allowed).toBe(false);
  });
});

describe('shouldExpire', () => {
  it('flags a lapsed trial for persistence', () => {
    expect(shouldExpire(subject({ trialEndsAt: day(-1) }), NOW)).toBe(true);
  });

  it('does not touch a live trial, ACTIVE, or already-EXPIRED rows', () => {
    expect(shouldExpire(subject({ trialEndsAt: day(1) }), NOW)).toBe(false);
    expect(shouldExpire(subject({ planStatus: 'ACTIVE', trialEndsAt: day(-9) }), NOW)).toBe(false);
    expect(shouldExpire(subject({ planStatus: 'EXPIRED', trialEndsAt: day(-9) }), NOW)).toBe(false);
  });
});

describe('device fingerprinting', () => {
  it('hashes the raw id and never returns it', () => {
    const h = hashDeviceId('device-abc');
    expect(h).not.toContain('device-abc');
    expect(h).toHaveLength(32);
    expect(hashDeviceId('device-abc')).toBe(h); // stable
    expect(hashDeviceId(' device-abc ')).toBe(h); // trimmed
    expect(hashDeviceId('device-xyz')).not.toBe(h);
  });
});

describe('single-device enforcement', () => {
  const A = hashDeviceId('device-A');
  const B = hashDeviceId('device-B');

  it('binds the FIRST device seen', () => {
    expect(evaluateDevice(null, A, 'TRIAL')).toEqual({ action: 'bind', deviceHash: A });
  });

  it('lets the SAME device straight through', () => {
    expect(evaluateDevice(A, A, 'TRIAL')).toEqual({ action: 'match' });
  });

  it('LOCKS on a second device instead of evicting the first', () => {
    const decision = evaluateDevice(A, B, 'TRIAL');
    expect(decision).toEqual({ action: 'lock', deviceHash: B });
    // The incoming device is recorded so an admin can restore onto it.
    expect(decision.action === 'lock' && decision.deviceHash).toBe(B);
  });

  it('does not re-lock an already-locked account', () => {
    // Otherwise every retry would churn pendingDeviceId.
    expect(evaluateDevice(A, B, 'DISABLED')).toEqual({ action: 'already-locked' });
  });

  it('skips enforcement when no device id is supplied', () => {
    // A missing header cannot be compared; this is an anti-sharing measure,
    // not a security boundary, so we do not lock people out over it.
    expect(evaluateDevice(A, null, 'TRIAL')).toEqual({ action: 'skip' });
    expect(evaluateDevice(null, null, 'TRIAL')).toEqual({ action: 'skip' });
  });

  it('binds a device for an ACTIVE user too', () => {
    expect(evaluateDevice(null, A, 'ACTIVE')).toEqual({ action: 'bind', deviceHash: A });
    expect(evaluateDevice(A, B, 'ACTIVE')).toEqual({ action: 'lock', deviceHash: B });
  });
});

describe('device-switch lifecycle', () => {
  it('first device → second device → admin restore', () => {
    const A = hashDeviceId('laptop');
    const B = hashDeviceId('phone');

    // 1. First login binds.
    const first = evaluateDevice(null, A, 'TRIAL');
    expect(first).toEqual({ action: 'bind', deviceHash: A });
    let activeDevice = first.action === 'bind' ? first.deviceHash : null;
    let status: 'TRIAL' | 'DISABLED' = 'TRIAL';

    // 2. Same device keeps working.
    expect(evaluateDevice(activeDevice, A, status)).toEqual({ action: 'match' });

    // 3. Second device locks the account.
    const second = evaluateDevice(activeDevice, B, status);
    expect(second.action).toBe('lock');
    const pendingDevice = second.action === 'lock' ? second.deviceHash : null;
    status = 'DISABLED';

    // Blocked while locked, with the device message.
    const blocked = evaluateAccess({ planStatus: 'DISABLED', trialEndsAt: day(3) }, NOW);
    expect(blocked.allowed).toBe(false);
    expect(blocked.code).toBe('DEVICE_LOCKED');

    // 4. Admin restore: adopt the pending device, return to TRIAL.
    activeDevice = pendingDevice;
    status = 'TRIAL';
    expect(evaluateDevice(activeDevice, B, status)).toEqual({ action: 'match' });
    expect(evaluateAccess({ planStatus: 'TRIAL', trialEndsAt: day(3) }, NOW).allowed).toBe(true);

    // And the OLD device is now the stranger.
    expect(evaluateDevice(activeDevice, A, status).action).toBe('lock');
  });
});
