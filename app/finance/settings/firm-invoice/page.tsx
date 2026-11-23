import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import FirmInvoiceSettingsForm from '@/components/finance/FirmInvoiceSettingsForm';
import { findFirmInvoiceSettings, EMPTY_FIRM_INVOICE_SETTINGS } from '@/lib/billing/firm-defaults';

export const metadata: Metadata = { title: 'Firm Invoice Details' };

export default async function FirmInvoiceSettingsPage() {
  const session = await requireRouteAccess('/finance/settings/firm-invoice');

  const settings = (await findFirmInvoiceSettings(session.firmId)) ?? EMPTY_FIRM_INVOICE_SETTINGS;

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col">
      <header className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Firm Invoice Details</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
          Letterhead address, VAT TIN, bank details, and signer printed on every generated invoice and
          billing breakdown. A matter&apos;s billing config can still override any of these per invoice.
        </p>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <FirmInvoiceSettingsForm initial={settings} />
      </div>
    </div>
  );
}
