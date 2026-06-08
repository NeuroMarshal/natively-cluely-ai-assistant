// premium/electron/services/licenseVerifyPolicy.ts
//
// Open-source local re-implementation of the formerly-proprietary license
// verification policy. Part of the AGPL-3.0 Natively fork.
//
// `classifyProVerify` decides what to do with the locally-cached premium state
// after a server `/v1/pro/verify` round-trip. It is deliberately PAYING-USER-SAFE:
// it only revokes on a CONFIRMED negative answer, and otherwise keeps the cached
// state (fail-open) so a transient network/server/rate-limit blip never locks a
// legitimate user out.
//
// In this open-source fork the LicenseManager always reports premium, so this
// policy is exercised only by its unit test and by any user who wires a real
// remote verification endpoint back in. The contract is preserved exactly.

export type ProVerifyVerdict = 'active' | 'revoke' | 'keep';

/** Errors that mean "transient — do not touch the user's cached entitlement". */
const TRANSIENT_ERRORS = new Set(['ip_blocked', 'account_suspended']);

/** Errors that are a CONFIRMED negative answer about the key itself. */
const REVOKE_ERRORS = new Set([
  'subscription_inactive',
  'key_not_found',
  'invalid_key_format',
]);

/**
 * Classify a `/v1/pro/verify` HTTP response.
 *
 * @param status HTTP status code (0 means network error / no response).
 * @param data   Parsed JSON body, or null if missing/unparseable.
 */
export function classifyProVerify(status: number, data: any): ProVerifyVerdict {
  const error: string | undefined =
    data && typeof data.error === 'string' ? data.error : undefined;

  // 1. Transient conditions take precedence over everything else — never revoke
  //    a paying user on a blip, even if the body claims has_pro:false.
  if (status === 0 || status >= 500 || status === 429) return 'keep';
  if (error && TRANSIENT_ERRORS.has(error)) return 'keep';

  // 2. Unparseable / missing body on a non-transient status → keep (avoid a
  //    false revoke from a body we couldn't read).
  if (data == null) return 'keep';

  // 3. Confirmed revoke: the server affirmatively says this key has no pro.
  if (status === 200 && data.has_pro === false) return 'revoke';
  if (error && REVOKE_ERRORS.has(error)) return 'revoke';

  // 4. Confirmed active.
  if (status === 200 && data.ok === true && data.has_pro === true) return 'active';

  // 5. Anything unrecognized → keep (paying-user-safe default).
  return 'keep';
}
