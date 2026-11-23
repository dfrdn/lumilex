import './load-env';
import './probe-websocket';
import { createClient } from '@supabase/supabase-js';
import { mintId } from '../lib/ids';

/**
 * Bootstrap a login on a fresh database: creates a confirmed auth user and its
 * `team` row. Idempotent per email.
 *
 * Usage: npx tsx scripts/dev-bootstrap-user.ts <firmIdOrSlug> <email> <password> [name] [role]
 *
 * The firm is explicit and required. `team` is a tenant table and its `firm_id`
 * column default is gone, so a row written without one raises 23502 — and a
 * script that guessed a firm would be worse, silently filing the first login of
 * a new tenant under someone else's. An existing team row for the email is
 * bound to the new auth user only when it already belongs to the firm named.
 */
async function main() {
  const [firmRef, email, password, name = 'Dev Admin', role = 'super_user'] = process.argv.slice(2);
  if (!firmRef || !email || !password) {
    console.error(
      'Usage: npx tsx scripts/dev-bootstrap-user.ts <firmIdOrSlug> <email> <password> [name] [role]',
    );
    process.exit(1);
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const column = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(firmRef)
    ? 'id'
    : 'slug';
  const { data: firm } = await supabase
    .from('firms')
    .select('id, slug, name')
    .eq(column, firmRef)
    .maybeSingle();
  if (!firm) {
    console.error(`No firm with ${column} "${firmRef}".`);
    process.exit(1);
  }
  const firmId = firm.id as string;

  const { data: existing } = await supabase
    .from('team')
    .select('person_id, auth_user_id, firm_id')
    .eq('email', email)
    .maybeSingle();
  if (existing && existing.firm_id !== firmId) {
    console.error(
      `${email} already belongs to another firm (${existing.firm_id}). ` +
        'One address cannot be two firms’ staff — use a different one.',
    );
    process.exit(1);
  }
  if (existing?.auth_user_id) {
    console.log(`team row for ${email} already bound to auth user — nothing to do`);
    return;
  }

  const { data: created, error: authErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authErr) throw new Error(`auth user create failed: ${authErr.message}`);

  const personId = existing?.person_id ?? mintId('user');
  const row = {
    notion_id: personId,
    person_id: personId,
    name,
    email,
    role,
    active: true,
    auth_user_id: created.user.id,
    created_time: new Date().toISOString(),
    firm_id: firmId,
  };

  const { error: teamErr } = existing
    ? await supabase.from('team').update({ auth_user_id: created.user.id, active: true }).eq('email', email)
    : await supabase.from('team').insert(row);
  if (teamErr) {
    // Don't leave a signed-in-capable auth user with no team row behind it.
    await supabase.auth.admin.deleteUser(created.user.id);
    throw new Error(`team row write failed: ${teamErr.message}`);
  }

  console.log(`bootstrapped ${role} ${email} in ${firm.slug} (person_id ${personId})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
