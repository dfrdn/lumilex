import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getClientStatement } from '@/lib/finance/get-client-statement';
import ClientStatementPrint from '@/components/finance/ClientStatementPrint';
import { getFirmConfig } from '@/lib/firm/config';
import { loadFirmContact } from '@/lib/firm-profile/load';

export async function generateMetadata(
  { params }: { params: Promise<{ name: string }> },
): Promise<Metadata> {
  const { name } = await params;
  return { title: `${decodeURIComponent(name)} · Statement` };
}

export default async function ClientStatementPage(
  { params }: { params: Promise<{ name: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const { name } = await params;
  const clientName = decodeURIComponent(name);
  const supabase = await getSupabaseServerAuthClient();

  const { statement, found } = await getClientStatement(supabase, clientName);

  const asOfToday = new Date().toLocaleDateString('en-PH', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila',
  });

  const [config, contact] = await Promise.all([
    getFirmConfig(session.firmId),
    loadFirmContact(session.firmId),
  ]);

  return (
    <ClientStatementPrint
      clientName={clientName}
      statement={statement}
      asOfToday={asOfToday}
      found={found}
      letterhead={{
        firmName: config.branding.documentName.trim() || config.name,
        addressLines: contact.addressLines,
      }}
    />
  );
}
