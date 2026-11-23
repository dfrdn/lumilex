import './load-env';
import './probe-websocket';
import { createOperator } from '../lib/platform/auth';

/**
 * Create the first (or the next) platform operator — the identity behind
 * /platform. Idempotent per email.
 *
 * Usage: npx tsx scripts/bootstrap-platform-operator.ts <email> <password> [name]
 *
 * There has to be a way to make the first operator and it cannot be the
 * surface itself, so this is it — service-role, run by whoever holds the keys.
 * It is also the lockout recovery path: `/platform` refuses to deactivate its
 * own last active operator (lib/platform/operator-lockout.ts), and if one is
 * ever lost some other way, this script is how the surface comes back.
 *
 * The logic is `createOperator` in lib/platform/auth.ts, which the operator
 * surface's own "add operator" form calls too — binding to an existing auth
 * user without resetting its password, reactivating a deactivated row rather
 * than colliding on the unique email, and cleaning up an auth user it created
 * if the operator insert fails. One definition, two callers.
 *
 * Deactivation is deliberately not here: /platform manages the roster, and the
 * guard against closing the surface on everyone lives there with it.
 */
async function main() {
  const [email, password, name] = process.argv.slice(2);
  if (!email || !password) {
    console.error(
      'Usage: npx tsx scripts/bootstrap-platform-operator.ts <email> <password> [name]',
    );
    process.exit(1);
  }

  const { operator, outcome, createdAuthUser } = await createOperator({ email, password, name });

  if (outcome === 'exists') {
    console.log(`${operator.email} is already an active platform operator — nothing to do`);
    return;
  }
  if (outcome === 'reactivated') {
    console.log(`reactivated platform operator ${operator.email}`);
    return;
  }
  if (!createdAuthUser) {
    console.log(`auth user for ${operator.email} already existed — bound to it (password unchanged)`);
  }
  console.log(
    `bootstrapped platform operator ${operator.email} (auth_user_id ${operator.authUserId})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
