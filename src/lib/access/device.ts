import { createHash } from 'node:crypto';
import type { PlanStatus } from '@prisma/client';

/**
 * SINGLE-DEVICE ENFORCEMENT (Phase 5).
 *
 * The browser generates a random device id once and stores it locally, sending
 * it as `x-device-id`. We persist only a HASH, so a database leak never yields
 * a usable device token.
 *
 * A second device does NOT silently evict the first. It locks the account
 * (DISABLED) and the user must ask an admin to restore — the deliberate
 * anti-sharing behavior asked for.
 *
 * Scope note: this is an account-sharing deterrent, not a security boundary. A
 * request with no `x-device-id` cannot be compared, so it is allowed through
 * rather than locking someone out over a missing header.
 */

export const DEVICE_HEADER = 'x-device-id';

/** Hash a raw client device id. Never store or log the raw value. */
export function hashDeviceId(raw: string): string {
  return createHash('sha256').update(raw.trim()).digest('hex').slice(0, 32);
}

/** Read and hash the device id from a request, if present. */
export function deviceHashFromRequest(request: Request): string | null {
  const raw = request.headers.get(DEVICE_HEADER);
  if (!raw || !raw.trim()) return null;
  return hashDeviceId(raw);
}

export type DeviceAction =
  /** No device id supplied — nothing to compare. */
  | { action: 'skip' }
  /** First device seen: bind it to the account. */
  | { action: 'bind'; deviceHash: string }
  /** Same device as before. */
  | { action: 'match' }
  /** Different device: lock the account and record the new device. */
  | { action: 'lock'; deviceHash: string }
  /** Already locked; do not overwrite the pending device. */
  | { action: 'already-locked' };

/**
 * Pure decision for one authenticated request.
 * `status` is consulted so a locked account is not re-locked (which would
 * churn `pendingDeviceId` on every retry).
 */
export function evaluateDevice(
  activeDeviceId: string | null,
  incomingHash: string | null,
  status: PlanStatus,
): DeviceAction {
  if (!incomingHash) return { action: 'skip' };
  if (status === 'DISABLED') return { action: 'already-locked' };
  if (!activeDeviceId) return { action: 'bind', deviceHash: incomingHash };
  if (activeDeviceId === incomingHash) return { action: 'match' };
  return { action: 'lock', deviceHash: incomingHash };
}
