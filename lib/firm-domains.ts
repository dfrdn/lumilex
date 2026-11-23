// Is this address one of the firm's own? A message whose sender is answers yes
// is the firm's own mail — direction 'outbound'; anyone else is incoming
// ('inbound').
//
// Direction is a property of the canonical (deduped) email, shared across every
// mailbox copy, so it must be firm-relative — keying off the specific synced
// mailbox address misclassifies firm mail that lands in another box (e.g. a
// colleague's filing CC'd to the docket group, or sent mail whose `from` Graph
// returns empty).
//
// The domain list is per-tenant (`firms.settings.email.ownedDomains`) and is
// passed in rather than read here, so this stays a pure function and so no
// tenant can inherit another's list. A firm that has configured no domains
// classifies everything as inbound: that under-claims its own sent mail, which
// is recoverable, where the alternative — treating another firm's domain as
// yours — files a stranger's mail as the firm's own work product.
export function isFirmAddress(
  addr: string | null | undefined,
  ownedDomains: readonly string[],
): boolean {
  const a = (addr ?? '').toLowerCase().trim();
  if (!a) return false;
  return ownedDomains.some((raw) => {
    const domain = raw.toLowerCase().trim().replace(/^@/, '');
    return domain.length > 0 && a.endsWith(`@${domain}`);
  });
}
