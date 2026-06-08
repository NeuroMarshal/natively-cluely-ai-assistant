// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Local fork compatibility shim.
//
// This AGPL-licensed fork keeps the public LicenseManager call surface so older
// desktop code paths continue to compile and run, but it does not perform
// entitlement checks, hardware binding or remote license verification. Former
// plan-gated desktop features are local source in this repository; there is no
// paid desktop entitlement to validate here. See FORK_NOTICE.md and NOTICE.

export interface LicenseDetails {
  isPremium: boolean;
  plan?: string;
  provider?: string;
}

export interface ActivationResult {
  success: boolean;
  error?: string;
  skipped?: boolean;
}

export class LicenseManager {
  private static instance: LicenseManager | null = null;

  static getInstance(): LicenseManager {
    if (!LicenseManager.instance) {
      LicenseManager.instance = new LicenseManager();
    }
    return LicenseManager.instance;
  }

  /**
   * Synchronous premium check. Always true in the open-source fork — every
   * feature is free.
   */
  isPremium(): boolean {
    return true;
  }

  /**
   * Server-revocation-aware premium check. There is no remote license server in
   * the open-source fork, so this always resolves true (and never makes a
   * network call).
   */
  async isPremiumAsync(): Promise<boolean> {
    return true;
  }

  /**
   * License detail object consumed by the renderer / IPC layer.
   *
   * `provider` intentionally identifies the local fork entitlement. There is no
   * external account or API key that can revoke it.
   */
  getLicenseDetails(): LicenseDetails {
    return { isPremium: true, plan: 'ultra', provider: 'open_source' };
  }

  /** Activating any key trivially "succeeds" — premium is already granted. */
  async activateLicense(_key: string): Promise<ActivationResult> {
    return { success: true };
  }

  /** Provider API keys never change entitlement here. */
  async activateWithApiKey(_apiKey: string): Promise<ActivationResult> {
    return { success: true };
  }

  /** No remote slot to free and no local license file to remove. */
  async deactivate(): Promise<void> {
    /* no-op: the open-source fork has no revocable license */
  }

  /**
   * A stable, non-identifying hardware id. The upstream build derived a real
   * HWID (via the native Rust module) to bind licenses to a machine; the
   * open-source fork has no licenses to bind, so it returns a constant.
   */
  getHardwareId(): string {
    return 'open-source-build';
  }
}
