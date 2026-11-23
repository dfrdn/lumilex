import webpush, { type PushSubscription as WebPushSubscription } from 'web-push';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { getFirmConfig, firmBaseUrl } from '@/lib/firm/config';
import { isFeatureAvailable } from '@/lib/firm/features';
import { brandAssetUrl } from '@/lib/firm/brand-shape';
import { appBaseUrlOrNull } from '@/lib/app-url';

/** True when the platform's VAPID keypair is present. Side-effect free, so the
 *  feature guard can ask without arming web-push. */
export function isPushConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT
  );
}

let vapidConfigured = false;
function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body?: string;
  href?: string;
  tag?: string;
  entityId?: string | null;
}

/**
 * Send a web push notification to every active subscription belonging to the
 * given emails. Respects the notify_push_enabled preference: an email that
 * opted out gets nothing. Dead subscriptions (410/404 from the push service)
 * are auto-removed.
 *
 * Fire-and-forget: never throw — push is best-effort on top of the in-app
 * notification row, which is the source of truth. A firm without the `push`
 * feature simply gets the in-app row and no browser notification.
 *
 * The guard lives here rather than at the four call sites so a new sender
 * cannot forget it. (features.ts imports isPushConfigured from this module;
 * the cycle is inert — both bindings are hoisted function declarations read
 * only inside function bodies, never at module evaluation.)
 */
export async function sendPushToEmails(
  emails: string[],
  payload: PushPayload,
  firmId: string,
): Promise<void> {
  if (!ensureVapidConfigured() || emails.length === 0) return;
  if (!(await isFeatureAvailable(firmId, 'push'))) return;

  const supabase = getServiceDbForFirm(firmId);

  const normalized = [...new Set(emails.map((e) => e.toLowerCase().trim()).filter(Boolean))];
  if (normalized.length === 0) return;

  // Filter to the emails that have push enabled
  const { data: prefs } = await supabase
    .from('user_preferences')
    .select('email, notify_push_enabled')
    .in('email', normalized);

  const enabled = new Set(
    (prefs ?? [])
      .filter((p) => p.notify_push_enabled === true)
      .map((p) => p.email),
  );
  if (enabled.size === 0) return;

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('email', [...enabled]);
  if (!subs || subs.length === 0) return;

  // The service worker is one static file served to every tenant, so it cannot
  // hold a firm's name or mark. Both ride on the payload instead, composed here
  // where the firm is known; a firm with no monogram sends no icon and the OS
  // uses its own default rather than another firm's mark.
  const config = await getFirmConfig(firmId);
  // Best-effort: the icon is an extra, not worth failing a delivery over a
  // missing platform URL. Resolve the firm's own host only once we know there
  // is a platform base for firmBaseUrl to derive scheme and port from.
  const base = appBaseUrlOrNull() ? await firmBaseUrl(firmId) : null;
  const icon =
    base && config.branding.monogramPath.trim()
      ? `${base}${brandAssetUrl(firmId, 'monogram')}`
      : null;

  const json = JSON.stringify({
    title: payload.title.trim() || config.branding.documentName.trim() || config.name,
    body: payload.body ?? '',
    href: payload.href ?? '/dashboard',
    tag: payload.tag,
    entityId: payload.entityId ?? null,
    icon,
    badge: icon,
  });

  const deadIds: number[] = [];
  await Promise.allSettled(
    subs.map(async (s) => {
      const sub: WebPushSubscription = {
        endpoint: s.endpoint,
        keys: { p256dh: s.p256dh, auth: s.auth },
      };
      try {
        await webpush.sendNotification(sub, json, { TTL: 60 * 60 });
      } catch (err: unknown) {
        const status =
          typeof err === 'object' && err !== null && 'statusCode' in err
            ? (err as { statusCode?: number }).statusCode
            : undefined;
        if (status === 404 || status === 410) {
          deadIds.push(s.id);
        } else {
          console.error('[push] send failed:', (err as Error).message || err);
        }
      }
    }),
  );

  if (deadIds.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', deadIds);
  }
}
