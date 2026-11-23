import { cache } from 'react';
import { headers } from 'next/headers';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';
import type { UserRole } from '@/lib/queries/team';

/**
 * Resolve the Supabase auth.users.id for the current request, honoring either
 * an `Authorization: Bearer <access_token>` header (mobile / non-browser
 * clients) or the cookie-based session set by the SSR helper (web).
 *
 * Bearer takes precedence: if a header is present but the token is invalid,
 * we return null rather than silently falling through to cookies — that path
 * almost always signals a real auth failure that the client should see.
 *
 * Exported for the third identity kind: `getOperatorSession` in
 * lib/platform/auth.ts resolves a different table off the same auth user, and
 * a second copy of this would be a second place for the bearer/cookie
 * precedence rule to drift.
 */
export async function getAuthUserId(): Promise<string | null> {
  const hdrs = await headers();
  const authHeader = hdrs.get('authorization');
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return null;
    const {
      data: { user },
    } = await getSupabase().auth.getUser(token);
    return user?.id ?? null;
  }

  const supabase = await getSupabaseServerAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export interface Session {
  firmId: string;
  user: {
    notionUserId: string;
    name: string;
    email: string;
    image?: string;
    nickname: string;
    role: UserRole;
  };
}

export interface PortalSession {
  firmId: string;
  user: {
    clientUserId: string;
    clientId: string;
    name: string;
    email: string;
  };
}

export const getSession = cache(async (): Promise<Session | null> => {
  const authUserId = await getAuthUserId();
  if (!authUserId) return null;

  const service = getSupabase();
  const { data: member } = await service
    .from('team')
    .select('person_id, name, email, nickname, avatar_url, role, firm_id')
    .eq('auth_user_id', authUserId)
    .eq('active', true)
    .single();

  if (!member) return null;

  return {
    firmId: member.firm_id,
    user: {
      notionUserId: member.person_id,
      name: member.name,
      email: member.email,
      image: member.avatar_url || undefined,
      nickname: member.nickname || '',
      role: (member.role as UserRole) ?? 'lawyer',
    },
  };
});

export const getPortalSession = cache(async (): Promise<PortalSession | null> => {
  const authUserId = await getAuthUserId();
  if (!authUserId) return null;

  const service = getSupabase();
  const { data: row } = await service
    .from('client_users')
    .select('id, client_id, name, email, firm_id')
    .eq('auth_user_id', authUserId)
    .eq('active', true)
    .single();

  if (!row) return null;

  return {
    firmId: row.firm_id,
    user: {
      clientUserId: row.id,
      clientId: row.client_id,
      name: row.name ?? '',
      email: row.email,
    },
  };
});
