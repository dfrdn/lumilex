/**
 * What is wrong with a tenant's configuration, as the operator list says it.
 *
 * Split out of `firms.ts` with no imports at all — same reasoning as
 * `feature-shape.ts` and `brand-shape.ts`: the rule is the interesting part and
 * it should be testable without a database, a firm, or the platform env that
 * `lib/firm/features.ts` pulls in through its credential predicates.
 *
 * The list's whole job on day one is to tell a working tenant from a
 * half-provisioned one. A misconfigured firm is otherwise silent until someone
 * tries to invoice or sign in, and that someone is the client.
 */

export interface FirmConfigurationFacts {
  status: string;
  primaryDomain: string | null;
  /** false when the firm has no firm_invoice_settings row at all. */
  invoiceSettingsPresent: boolean;
  /**
   * Human labels of the required invoice fields still blank or still carrying a
   * provisioning placeholder — `missingInvoiceSettings()` from
   * lib/billing/firm-defaults.ts, which is the one place that rule lives.
   */
  invoiceSettingsMissing: readonly string[];
  activeTeamCount: number;
}

/** Empty means nothing found — not "not checked". */
export function firmConfigurationIssues(facts: FirmConfigurationFacts): string[] {
  const issues: string[] = [];

  if (facts.status !== 'active') {
    issues.push(`Status is ${facts.status}`);
  }

  // Not fatal — firmBaseUrl() falls back to the platform URL — but every portal
  // invite and notification mail this firm sends then links to the platform
  // host under the firm's name.
  if (!facts.primaryDomain) {
    issues.push('No primary domain — outbound links fall back to the platform host');
  }

  if (!facts.invoiceSettingsPresent) {
    issues.push('No invoice settings row — invoicing and branded documents will refuse');
  } else if (facts.invoiceSettingsMissing.length > 0) {
    issues.push(`Invoice settings incomplete: ${facts.invoiceSettingsMissing.join(', ')}`);
  }

  if (facts.activeTeamCount === 0) {
    issues.push('No active team member — nobody can sign in');
  }

  return issues;
}
