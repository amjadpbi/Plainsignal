import type { PlanStatus } from '@prisma/client';

/**
 * ACCESS POLICY (Phase 5).
 *
 * Manual, admin-driven access control — no payment gateway. Deliberately
 * expressed as pure functions over a small state shape so that automated
 * billing can later drive `planStatus` (and `PlanTier`) without any of this
 * logic being rewritten: a provider webhook would simply set ACTIVE/EXPIRED.
 *
 * Nothing here talks to a database, a request, or a vendor.
 */

/** Default trial length. Per-user overrides live in `trialEndsAt`. */
export const TRIAL_DAYS = 7;

export type AccessCode = 'OK' | 'TRIAL_EXPIRED' | 'DEVICE_LOCKED';

export type AccessSubject = {
  planStatus: PlanStatus;
  trialEndsAt: Date | null;
};

export type AccessDecision = {
  allowed: boolean;
  code: AccessCode;
  status: PlanStatus;
  trialEndsAt: Date | null;
  /** Whole days remaining in the trial; null when not on trial. */
  daysLeft: number | null;
  /** User-facing explanation. Never a generic error string. */
  message: string;
};

const MS_PER_DAY = 86_400_000;

/** trialEndsAt for a signup happening at `now`. */
export function trialEndsAtFrom(now: Date, days: number = TRIAL_DAYS): Date {
  return new Date(now.getTime() + days * MS_PER_DAY);
}

/** Whole days remaining, floored at 0. */
export function daysRemaining(trialEndsAt: Date | null, now: Date): number | null {
  if (!trialEndsAt) return null;
  return Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / MS_PER_DAY));
}

/**
 * Decide whether a user may perform a gated action.
 *
 * ACTIVE bypasses the trial clock entirely. DISABLED is currently only ever
 * set by the single-device rule, so it reports DEVICE_LOCKED.
 */
export function evaluateAccess(
  user: AccessSubject,
  now: Date,
  opts: { supportContact?: string } = {},
): AccessDecision {
  const contact = opts.supportContact?.trim();
  const contactSuffix = contact ? ` Contact ${contact} to activate your account.` : '';

  const base = {
    status: user.planStatus,
    trialEndsAt: user.trialEndsAt,
    daysLeft: daysRemaining(user.trialEndsAt, now),
  };

  if (user.planStatus === 'DISABLED') {
    return {
      ...base,
      allowed: false,
      code: 'DEVICE_LOCKED',
      daysLeft: null,
      message:
        'An active session was detected on another device. For security, this account is locked to one device at a time.' +
        (contact ? ` Request access below, or contact ${contact}.` : ' Request access below.'),
    };
  }

  if (user.planStatus === 'ACTIVE') {
    return { ...base, allowed: true, code: 'OK', daysLeft: null, message: 'Your account is active.' };
  }

  if (user.planStatus === 'EXPIRED') {
    return {
      ...base,
      allowed: false,
      code: 'TRIAL_EXPIRED',
      daysLeft: 0,
      message: `Your free trial has ended.${contactSuffix || ' Contact the administrator to activate your account.'}`,
    };
  }

  // TRIAL
  if (user.trialEndsAt && now.getTime() > user.trialEndsAt.getTime()) {
    return {
      ...base,
      allowed: false,
      code: 'TRIAL_EXPIRED',
      daysLeft: 0,
      message: `Your free trial ended on ${user.trialEndsAt.toISOString().slice(0, 10)}.${
        contactSuffix || ' Contact the administrator to activate your account.'
      }`,
    };
  }

  const left = base.daysLeft;
  return {
    ...base,
    allowed: true,
    code: 'OK',
    message:
      left === null
        ? 'Trial active.'
        : `Trial active — ${left} day${left === 1 ? '' : 's'} remaining.`,
  };
}

/**
 * True when a TRIAL user's clock has run out and the row should be flipped to
 * EXPIRED. Kept separate so the caller owns persistence.
 */
export function shouldExpire(user: AccessSubject, now: Date): boolean {
  return (
    user.planStatus === 'TRIAL' &&
    user.trialEndsAt !== null &&
    now.getTime() > user.trialEndsAt.getTime()
  );
}
