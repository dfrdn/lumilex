import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getClientStatement } from '@/lib/finance/get-client-statement';
import { manilaToday } from '@/lib/finance/format';
import ClientLedgerView from '@/components/finance/ClientLedgerView';

export async function generateMetadata(
  { params }: { params: Promise<{ name: string }> },
): Promise<Metadata> {
  const { name } = await params;
  return { title: `${decodeURIComponent(name)} · Ledger` };
}

export default async function ClientLedgerPage(
  { params }: { params: Promise<{ name: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const { name } = await params;
  const clientName = decodeURIComponent(name);
  const supabase = await getSupabaseServerAuthClient();

  const { statement, found } = await getClientStatement(supabase, clientName);

  return (
    <>
      <ClientLedgerView
        clientName={clientName}
        statement={statement}
        found={found}
        asOfToday={manilaToday()}
      />
    </>
  );
}
