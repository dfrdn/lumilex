'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { SWRConfig } from 'swr';
import { swrConfig } from '@/lib/swr';
import { getSupabaseBrowserAuthClient } from '@/lib/supabase-browser';
import type { Session } from '@/lib/session';

type Status = 'authenticated' | 'unauthenticated';

interface SessionContextValue {
  data: Session | null;
  status: Status;
  update: () => Promise<void>;
}

async function fetchSession(): Promise<Session | null> {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) return null;
    const body = await res.json();
    return body?.session ?? null;
  } catch {
    return null;
  }
}

const SessionContext = createContext<SessionContextValue>({
  data: null,
  status: 'unauthenticated',
  update: async () => {},
});

export function useSession() {
  return useContext(SessionContext);
}

export default function SessionProvider({
  children,
  initialSession,
}: {
  children: React.ReactNode;
  initialSession: Session | null;
}) {
  const [session, setSession] = useState<Session | null>(initialSession);
  // Auth user the held session was loaded for; null while none is held.
  const loadedFor = useRef<string | null>(null);
  const hasInitialSession = useRef(initialSession !== null);
  const seeded = useRef(false);

  const load = useCallback(async (authUserId: string | null) => {
    const next = await fetchSession();
    loadedFor.current = next ? authUserId : null;
    setSession(next);
  }, []);

  const update = () => load(loadedFor.current);

  useEffect(() => {
    const supabase = getSupabaseBrowserAuthClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, authSession) => {
      const userId = authSession?.user?.id ?? null;
      // The first event reports the cookie session the server rendered
      // `initialSession` from, so a held initial session belongs to this user.
      if (!seeded.current) {
        seeded.current = true;
        if (hasInitialSession.current) loadedFor.current = userId;
      }

      if (event === 'SIGNED_OUT') {
        loadedFor.current = null;
        setSession(null);
      } else if (event === 'SIGNED_IN') {
        // supabase-js re-emits SIGNED_IN for the unchanged session whenever a
        // hidden tab becomes visible, and /api/me costs an Auth round trip
        // plus a team lookup. Refetch only when the signed-in user changed.
        if (userId !== loadedFor.current) void load(userId);
      } else if (event === 'TOKEN_REFRESHED') {
        void load(userId);
      }
    });
    return () => subscription.unsubscribe();
  }, [load]);

  return (
    <SWRConfig value={swrConfig}>
      <SessionContext.Provider
        value={{ data: session, status: session ? 'authenticated' : 'unauthenticated', update }}
      >
        {children}
      </SessionContext.Provider>
    </SWRConfig>
  );
}
