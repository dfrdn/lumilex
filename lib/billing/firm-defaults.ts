/**
 * Firm-wide invoice settings (letterhead address, TIN, bank, signer), read
 * from the per-firm `firm_invoice_settings` row managed under
 * /finance/settings/firm-invoice.
 *
 * There is deliberately NO in-code fallback: an incomplete configuration must
 * surface as an error, never resolve to another firm's letterhead or bank
 * account. Generation paths call {@link getFirmInvoiceSettings} (throws when
 * the row is missing OR still incomplete); the settings surface calls
 * {@link findFirmInvoiceSettings} to render the form as it stands.
 *
 * "Present but incomplete" is the case provisioning creates: a new firm's row
 * is written with a real `invoice_prefix` and {@link invoicePlaceholder} bank
 * and TIN values, because nobody at onboarding time knows the firm's account
 * number. A blank field and a placeholder field are the same thing here —
 * both mean *nobody has said where the money goes* — and both must stop an
 * invoice rather than print an invoice that quietly names nothing.
 */
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

export type FirmInvoiceSettings = {
  firmAddress: string;
  firmAddress2: string;
  firmTIN: string;
  bankName: string;
  bankAccountNo: string;
  bankAccountName: string;
  signerName: string;
  invoicePrefix: string;
};

export const EMPTY_FIRM_INVOICE_SETTINGS: FirmInvoiceSettings = {
  firmAddress: '',
  firmAddress2: '',
  firmTIN: '',
  bankName: '',
  bankAccountNo: '',
  bankAccountName: '',
  signerName: '',
  invoicePrefix: '',
};

// ── Completeness ─────────────────────────────────────────────────────

/**
 * Lead-in of the value provisioning stamps into a field it cannot know. It is
 * deliberately a phrase a person reads as an instruction in the settings form,
 * and a string {@link isInvoicePlaceholder} recognises in code.
 */
export const INVOICE_PLACEHOLDER_PREFIX = 'PLACEHOLDER —';

/** The placeholder value for one field, e.g. "PLACEHOLDER — bank name not set". */
export function invoicePlaceholder(label: string): string {
  return `${INVOICE_PLACEHOLDER_PREFIX} ${label} not set`;
}

export function isInvoicePlaceholder(value: string): boolean {
  return value.trimStart().startsWith(INVOICE_PLACEHOLDER_PREFIX);
}

/**
 * The fields an invoice, a proposal's payment block, or a branded letterhead
 * actually prints. `firmAddress2` is the optional second address line and is
 * not required.
 */
const REQUIRED_FIELDS: ReadonlyArray<[keyof FirmInvoiceSettings, string]> = [
  ['firmAddress', 'firm address'],
  ['firmTIN', 'TIN'],
  ['bankName', 'bank name'],
  ['bankAccountNo', 'bank account number'],
  ['bankAccountName', 'bank account name'],
  ['signerName', 'signer name'],
  ['invoicePrefix', 'invoice prefix'],
];

/**
 * Human labels of the required fields that are still blank or still carry a
 * provisioning placeholder. Empty means the settings are safe to print.
 *
 * Pure, so the rule is tested without a database and can be reused by any
 * surface that wants to warn before a generation path refuses.
 */
export function missingInvoiceSettings(settings: FirmInvoiceSettings): string[] {
  return REQUIRED_FIELDS.filter(([field]) => {
    const value = settings[field] ?? '';
    return !value.trim() || isInvoicePlaceholder(value);
  }).map(([, label]) => label);
}

export function isFirmInvoiceSettingsComplete(settings: FirmInvoiceSettings): boolean {
  return missingInvoiceSettings(settings).length === 0;
}

const SETTINGS_COLUMNS =
  'firm_address, firm_address2, firm_tin, bank_name, bank_account_no, bank_account_name, signer_name, invoice_prefix';

/** Uses the service-role client so cron / MP-approval generation paths
 * (which have no user JWT) still resolve it. Returns null when the firm has
 * not configured invoice settings yet. */
export async function findFirmInvoiceSettings(
  firmId: string,
): Promise<FirmInvoiceSettings | null> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('firm_invoice_settings')
    .select(SETTINGS_COLUMNS)
    .maybeSingle();

  if (error) throw new Error(`firm_invoice_settings read failed: ${error.message}`);
  if (!data) return null;

  return {
    firmAddress: data.firm_address ?? '',
    firmAddress2: data.firm_address2 ?? '',
    firmTIN: data.firm_tin ?? '',
    bankName: data.bank_name ?? '',
    bankAccountNo: data.bank_account_no ?? '',
    bankAccountName: data.bank_account_name ?? '',
    signerName: data.signer_name ?? '',
    invoicePrefix: data.invoice_prefix ?? '',
  };
}

/** Invoice/document generation entry point: throws when the firm has no
 * configured settings, and equally when the row is still the placeholder one
 * provisioning wrote, so nothing renders with missing or foreign details. */
export async function getFirmInvoiceSettings(firmId: string): Promise<FirmInvoiceSettings> {
  const settings = await findFirmInvoiceSettings(firmId);
  if (!settings) {
    throw new Error(
      'Firm invoice settings are not configured — set them under Finance → Settings → Firm invoice before generating documents.',
    );
  }
  const missing = missingInvoiceSettings(settings);
  if (missing.length > 0) {
    throw new Error(
      `Firm invoice settings are incomplete (${missing.join(', ')}) — complete them under ` +
        'Finance → Settings → Firm invoice before generating documents.',
    );
  }
  return settings;
}

/**
 * Whether the billing letter writes "Atty." before the signatory's printed
 * name — a letter setting kept beside the firm's invoice details, edited on the
 * Billing Letter page. Off when the firm has no settings row yet.
 */
export async function findSignerAtty(firmId: string): Promise<boolean> {
  const { data, error } = await getServiceDbForFirm(firmId)
    .from('firm_invoice_settings')
    .select('signer_atty')
    .maybeSingle();
  if (error) throw new Error(`firm_invoice_settings read failed: ${error.message}`);
  return data?.signer_atty === true;
}
