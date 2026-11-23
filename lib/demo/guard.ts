import { NextResponse } from 'next/server';
import { getFirmConfig } from '@/lib/firm/config';
import { isDemoDeploymentEnv } from '@/lib/demo/sign-in';

/**
 * The refusals that keep the public demo usable by the next visitor.
 *
 * Anyone can sign in to the demo firm, as a partner, finance or admin. Its
 * content resets nightly, so ordinary work — editing a matter, filing a
 * deliverable, recording a payment — is exactly what a visitor should do. What
 * a visitor must not do is anything the reset cannot undo or that reaches
 * past the firm: change or create a login (the personas are shared, and
 * `auth.users` is not a firm's rows), invite a portal user, upload to a public
 * bucket, or write a global table every firm on the instance reads.
 *
 * Keyed on the firm's `settings.demo.enabled` alone, not on the deployment:
 * refusing more is the safe direction, so a demo firm is guarded wherever its
 * requests are served.
 */

export async function isDemoFirm(firmId: string): Promise<boolean> {
  return (await getFirmConfig(firmId)).demo.enabled;
}

/** A 403 naming what was refused when the firm is the demo; null otherwise. */
export async function refuseInDemo(firmId: string, what: string): Promise<NextResponse | null> {
  if (!(await isDemoFirm(firmId))) return null;
  return NextResponse.json({ error: `${what} isn’t available in the demo.` }, { status: 403 });
}

/** Whether this deployment declared itself the demo. See lib/demo/sign-in.ts. */
export function isDemoDeployment(): boolean {
  return isDemoDeploymentEnv(process.env);
}
