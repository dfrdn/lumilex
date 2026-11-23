import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm, firmStoragePath } from '@/lib/tenancy/service-db';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { mintId } from '@/lib/ids';
import { pathsNotUnder } from '@/lib/storage/upload-path';
import { signStoragePaths } from '@/lib/storage-sign';

/**
 * The one folder a reimbursement's receipts may live in. Minted in phase 1 and
 * re-derived wherever a supplied path is signed: these receipts are signed for
 * a YEAR and the URL is stored on the row, so one unchecked path is a year-long
 * download link to another firm's document.
 *
 * On create the row doesn't exist yet, so the id in the key is the one phase 1
 * minted — the firm segment is what keeps the key inside the caller's own
 * storage. On edit the id comes from the RLS-owned row.
 */
function receiptPrefix(firmId: string, reimbursementId: string): string {
  return firmStoragePath(firmId, `${reimbursementId}/`);
}

export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;

  try {
    const supabase = await getSupabaseServerAuthClient();

    // Scope to the caller's own filings explicitly. reimbursements_select also
    // grants finance/admin/super_user every row — right for the finance views,
    // wrong for this personal endpoint, which would otherwise list the firm's
    // entire expense history under "My Requests". Both identifiers are needed
    // because lawyer_ids holds team.notion_id on legacy rows and team.person_id
    // on newer ones.
    const { data: teamRow } = await supabase
      .from('team')
      .select('notion_id')
      .eq('person_id', personId)
      .maybeSingle();

    const identifiers = [personId, teamRow?.notion_id].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );

    const { data, error } = await supabase
      .from('reimbursements')
      .select('notion_id, expense, amount, expense_category, expense_date, matter_id, matter_name, client_id, client_name, reimbursed, receipt_urls, synced_at')
      .overlaps('lawyer_ids', identifiers)
      .order('expense_date', { ascending: false });

    if (error) {
      console.error('[reimbursement]', error.message); return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    return NextResponse.json({ reimbursements: data ?? [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function sanitizeName(name: string) {
  return name
    .replace(/[\[\](){}]/g, '')
    .replace(/[^a-zA-Z0-9._\-\s]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * POST /api/reimbursement
 * Two-phase upload using signed URLs.
 *
 * Phase 1 — get signed URLs for receipts:
 *   Body JSON: { receipts: [{ name, type, size }] }
 *   Returns: { tempId, uploads: [{ name, storagePath, signedUrl, token }] }
 *
 * Phase 2 — confirm and create reimbursement:
 *   Body JSON: { confirm: true, tempId, expense, amount, expenseCategory, expenseDate, clientId, matterId?,
 *                receipts: [{ name, storagePath }] }
 *   Returns: { ok: true }
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;

  try {
    const body = await req.json();
    const supabase = await getSupabaseServerAuthClient();
    // Storage signing + cross-team lookups (matters, clients) need service-role.
    const service = getServiceDbForFirm(session.firmId);

    // Phase 2: Confirm uploads and create reimbursement record
    if (body.confirm) {
      const { tempId, expense, amount, expenseCategory, expenseDate, clientId, matterId, receipts } = body;

      if (!expense || !amount || !expenseCategory || !expenseDate || !clientId) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
      }
      if (typeof tempId !== 'string' || !tempId) {
        return NextResponse.json({ error: 'Missing tempId' }, { status: 400 });
      }

      const suppliedReceipts = (receipts ?? []) as { name: string; storagePath: string }[];
      const foreign = pathsNotUnder(
        suppliedReceipts.map((r) => r.storagePath),
        receiptPrefix(session.firmId, tempId),
      );
      if (foreign.length > 0) {
        console.error('[reimbursement] rejected receipt paths outside the receipt prefix:', foreign);
        return NextResponse.json({ error: 'Invalid receipt path' }, { status: 400 });
      }

      // Resolve the lawyer's team notion_id
      const { data: lawyerRow } = await supabase
        .from('team')
        .select('notion_id, name')
        .eq('person_id', personId)
        .eq('active', true)
        .limit(1)
        .single();

      const lawyerNotionId = lawyerRow?.notion_id ?? '';
      const lawyerName = lawyerRow?.name ?? '';

      // Resolve matter and client names
      let matterName = '';
      let clientName = '';

      if (matterId) {
        const { data: matterRow } = await service
          .from('matters')
          .select('name, client_name')
          .eq('notion_id', matterId)
          .single();
        matterName = matterRow?.name ?? '';
        clientName = matterRow?.client_name ?? '';
      }

      if (clientId && !clientName) {
        const { data: clientRow } = await service
          .from('clients')
          .select('name')
          .eq('notion_id', clientId)
          .single();
        clientName = clientRow?.name ?? '';
      }

      // Build receipt URLs from confirmed uploads.
      // Use signed URLs (1-year expiry) with the storage path preserved, so
      // the link works whether the `receipts` bucket is public or not, and
      // can be re-signed later via the storage path if it ever expires.
      const SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24 * 365; // 1 year
      const signedReceipts = await signStoragePaths(
        service,
        'receipts',
        suppliedReceipts.map((r) => r.storagePath),
        SIGNED_URL_EXPIRY_SECONDS,
      );
      const receiptUrls: { name: string; url: string; path: string }[] = suppliedReceipts.map((r) => ({
        name: r.name,
        url: signedReceipts.get(r.storagePath) ?? '',
        path: r.storagePath,
      }));

      const { error: dbErr } = await supabase
        .from('reimbursements')
        .insert({
          firm_id: session.firmId,
          notion_id: tempId,
          notion_url: '',
          expense,
          amount: parseFloat(amount),
          expense_category: expenseCategory,
          expense_date: expenseDate,
          lawyer_ids: lawyerNotionId ? [lawyerNotionId] : [],
          lawyer_name: lawyerName,
          matter_id: matterId || null,
          matter_name: matterName,
          client_id: clientId,
          client_name: clientName,
          reimbursed: false,
          created_by_name: lawyerName,
          receipt_urls: receiptUrls,
          synced_at: new Date().toISOString(),
        });

      if (dbErr) {
        console.error('[reimbursement] Supabase insert error:', dbErr.message);
        return NextResponse.json({ error: dbErr.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true });
    }

    // Phase 1: Generate signed upload URLs for receipts.
    // For edits, callers pass `reimbursementId` so new receipts go under the
    // existing row's folder instead of a fresh temp folder.
    const receipts: { name: string; type: string; size: number }[] = body.receipts ?? [];
    const reimbursementId: string | undefined = body.reimbursementId;

    // An edit uploads into an existing row's folder, so that row has to be the
    // caller's — otherwise phase 1 hands out a write URL into another firm's
    // receipt folder.
    if (reimbursementId) {
      const owned = await loadOwnedReimbursement(session.firmId, reimbursementId);
      if ('error' in owned) {
        return NextResponse.json({ error: owned.error }, { status: owned.status });
      }
    }

    const tempId = reimbursementId ?? mintId('reimb');

    const uploads: { name: string; storagePath: string; signedUrl: string; token: string }[] = [];

    for (const receipt of receipts) {
      const sanitized = sanitizeName(receipt.name);
      // Prefix with a short timestamp on edit uploads so repeat filenames don't collide
      const filename = reimbursementId ? `${Date.now()}-${sanitized}` : sanitized;
      const storagePath = `${receiptPrefix(session.firmId, tempId)}${filename}`;

      const { data, error } = await service.storage
        .from('receipts')
        .createSignedUploadUrl(storagePath);

      if (error) {
        console.error('[reimbursement] Signed URL failed:', error.message);
        continue;
      }

      uploads.push({
        name: receipt.name,
        storagePath,
        signedUrl: data.signedUrl,
        token: data.token,
      });
    }

    return NextResponse.json({ tempId, uploads });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[reimbursement] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

type ReceiptItem = { name: string; url: string; path?: string };

async function loadOwnedReimbursement(firmId: string, notionId: string) {
  const supabase = await getSupabaseServerAuthClient();
  // RLS scopes the read; if the row isn't visible it's either non-existent or
  // not owned. Either way the caller sees 404.
  const { data: row, error } = await supabase
    .from('reimbursements')
    .select('notion_id, lawyer_ids, reimbursed, receipt_urls')
    .eq('notion_id', notionId)
    .single();

  if (error || !row) return { error: 'Not found' as const, status: 404 };

  return { row, supabase, service: getServiceDbForFirm(firmId) };
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;

  try {
    const body = await req.json();
    const {
      notionId,
      expense,
      amount,
      expenseCategory,
      expenseDate,
      clientId,
      matterId,
      addReceipts,
      removeReceiptPaths,
    } = body as {
      notionId?: string;
      expense?: string;
      amount?: number | string;
      expenseCategory?: string;
      expenseDate?: string;
      clientId?: string | null;
      matterId?: string | null;
      addReceipts?: { name: string; storagePath: string }[];
      removeReceiptPaths?: string[];
    };

    if (!notionId) {
      return NextResponse.json({ error: 'notionId is required' }, { status: 400 });
    }

    const result = await loadOwnedReimbursement(session.firmId, notionId);
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const { row, supabase, service } = result;

    const fieldUpdates =
      expense !== undefined ||
      amount !== undefined ||
      expenseCategory !== undefined ||
      expenseDate !== undefined ||
      clientId !== undefined ||
      matterId !== undefined ||
      (removeReceiptPaths && removeReceiptPaths.length > 0);

    if (row.reimbursed && fieldUpdates) {
      return NextResponse.json(
        { error: 'Reimbursed entries can only accept new receipts' },
        { status: 409 },
      );
    }

    const record: Record<string, unknown> = {};

    if (expense !== undefined) {
      if (!expense.trim()) return NextResponse.json({ error: 'expense cannot be empty' }, { status: 400 });
      record.expense = expense;
    }
    if (amount !== undefined) {
      const amt = typeof amount === 'string' ? parseFloat(amount) : amount;
      if (!isFinite(amt) || amt <= 0) {
        return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 });
      }
      record.amount = amt;
    }
    if (expenseCategory !== undefined) record.expense_category = expenseCategory;
    if (expenseDate !== undefined) record.expense_date = expenseDate || null;

    // Client / matter — resolve names alongside ids via service-role (matters
    // and clients RLS land in PR 5).
    if (matterId !== undefined) {
      if (matterId) {
        const { data: matterRow } = await service
          .from('matters')
          .select('name, client_id, client_name')
          .eq('notion_id', matterId)
          .single();
        record.matter_id = matterId;
        record.matter_name = matterRow?.name ?? '';
        // When a matter is chosen, prefer its client linkage
        if (matterRow?.client_id) {
          record.client_id = matterRow.client_id;
          record.client_name = matterRow.client_name ?? '';
        }
      } else {
        record.matter_id = null;
        record.matter_name = '';
      }
    }

    if (clientId !== undefined && record.client_id === undefined) {
      if (clientId) {
        const { data: clientRow } = await service
          .from('clients')
          .select('name')
          .eq('notion_id', clientId)
          .single();
        record.client_id = clientId;
        record.client_name = clientRow?.name ?? '';
      } else {
        return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
      }
    }

    // Receipts: remove then add
    const currentReceipts: ReceiptItem[] = Array.isArray(row.receipt_urls)
      ? (row.receipt_urls as ReceiptItem[])
      : [];

    let nextReceipts: ReceiptItem[] = currentReceipts;

    if (removeReceiptPaths && removeReceiptPaths.length > 0) {
      const toRemove = new Set(removeReceiptPaths);
      const paths = currentReceipts
        .filter((r) => r.path && toRemove.has(r.path))
        .map((r) => r.path as string);
      if (paths.length > 0) {
        const { error: delErr } = await service.storage.from('receipts').remove(paths);
        if (delErr) {
          console.error('[reimbursement PATCH] storage remove failed:', delErr.message);
        }
      }
      nextReceipts = currentReceipts.filter((r) => !r.path || !toRemove.has(r.path));
    }

    if (addReceipts && addReceipts.length > 0) {
      // `notionId` is the row RLS just proved the caller owns, and phase 1 mints
      // edit uploads under exactly this folder.
      const foreign = pathsNotUnder(
        addReceipts.map((r) => r.storagePath),
        receiptPrefix(session.firmId, notionId),
      );
      if (foreign.length > 0) {
        console.error('[reimbursement PATCH] rejected receipt paths outside the receipt prefix:', foreign);
        return NextResponse.json({ error: 'Invalid receipt path' }, { status: 400 });
      }

      const SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24 * 365;
      const signedUrls = await signStoragePaths(
        service,
        'receipts',
        addReceipts.map((r) => r.storagePath),
        SIGNED_URL_EXPIRY_SECONDS,
      );
      const signed: ReceiptItem[] = addReceipts.map((r) => ({
        name: r.name,
        url: signedUrls.get(r.storagePath) ?? '',
        path: r.storagePath,
      }));
      nextReceipts = [...nextReceipts, ...signed];
    }

    if (nextReceipts !== currentReceipts) {
      record.receipt_urls = nextReceipts;
    }

    if (Object.keys(record).length === 0) {
      return NextResponse.json({ ok: true, receipts: nextReceipts });
    }

    const { error: updateErr } = await supabase
      .from('reimbursements')
      .update(record)
      .eq('notion_id', notionId);

    if (updateErr) {
      console.error('[reimbursement PATCH] update failed:', updateErr.message);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, receipts: nextReceipts });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[reimbursement PATCH] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;

  try {
    const url = new URL(req.url);
    const notionId = url.searchParams.get('notionId');

    if (!notionId) {
      return NextResponse.json({ error: 'notionId is required' }, { status: 400 });
    }

    const result = await loadOwnedReimbursement(session.firmId, notionId);
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const { row, supabase, service } = result;

    if (row.reimbursed) {
      return NextResponse.json(
        { error: 'Reimbursed entries cannot be deleted' },
        { status: 409 },
      );
    }

    const receipts: ReceiptItem[] = Array.isArray(row.receipt_urls)
      ? (row.receipt_urls as ReceiptItem[])
      : [];
    const paths = receipts.map((r) => r.path).filter((p): p is string => typeof p === 'string');
    if (paths.length > 0) {
      const { error: delErr } = await service.storage.from('receipts').remove(paths);
      if (delErr) {
        console.error('[reimbursement DELETE] storage remove failed:', delErr.message);
      }
    }

    const { error: rowErr } = await supabase
      .from('reimbursements')
      .delete()
      .eq('notion_id', notionId);

    if (rowErr) {
      console.error('[reimbursement DELETE] delete failed:', rowErr.message);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[reimbursement DELETE] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
