import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { homeFor } from '@/lib/nav/access';
import { cookies } from 'next/headers';
import LoginForm from '@/components/LoginForm';
import { BrandMonogram } from '@/components/BrandMark';
import { brandDisplayName, resolveRequestBrand } from '@/lib/firm/web-brand';
import { resolveRequestDemo } from '@/lib/demo/request';
import { DEMO_PERSONA_COPY, isDemoPersonaKey } from '@/lib/demo/personas';
import { ArrowRight } from 'lucide-react';
import { DEMO_ACCESS_COOKIE } from '@/lib/demo/access';
import { hasDemoAccess } from '@/lib/demo/access-store';
import DemoAccessForm from '@/components/DemoAccessForm';
import SourceLink from '@/components/SourceLink';

export const metadata: Metadata = { title: 'Sign In' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; as?: string; switch?: string; invalid?: string }>;
}) {
  const { error, as, switch: switching, invalid } = await searchParams;
  // On the public demo this page is the role picker. A visitor already signed
  // in as one persona comes back here from the banner to pick another, so the
  // usual bounce to their landing page is skipped for them.
  const demo = await resolveRequestDemo();

  const session = await getSession();
  if (session && !(demo && switching)) redirect(homeFor(session.user.role));

  // The demo asks who you are once (lib/demo/access.ts). With the access
  // cookie, `https://demo.{domain}/?as=partner` signs straight in; without it
  // the same link lands on the form below with that role chosen.
  const access = demo ? await hasDemoAccess((await cookies()).get(DEMO_ACCESS_COOKIE)?.value) : false;
  if (demo && access && isDemoPersonaKey(as)) {
    redirect(`/api/auth/demo?as=${as}`);
  }

  // Pre-auth: the firm comes from the request Host. An unmapped host renders the
  // neutral platform card rather than whichever tenant is first in the table.
  const brand = await resolveRequestBrand();
  const firmName = brandDisplayName(brand);
  const nameLines = brand.nameLines.length > 0 ? brand.nameLines : firmName ? [firmName] : [];

  return (
    <main className={`min-h-screen flex items-center justify-center bg-background relative overflow-hidden px-4 py-10 ${demo ? 'pb-24' : ''}`}>
      {/* Ambient background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-gold-400/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-navy-500/5 rounded-full blur-3xl" />
      </div>

      <div className={`relative z-10 bg-card rounded-2xl shadow-[var(--shadow-elevated)] border border-[var(--border-color)] p-10 sm:p-12 flex flex-col items-center gap-6 w-full ${demo ? 'max-w-md' : 'max-w-sm'} animate-fade-up`}>
        {/* Logo / wordmark */}
        <div className="flex flex-col items-center gap-3">
          <BrandMonogram />
          <div className="flex flex-col items-center gap-1">
            <span className="font-serif text-3xl font-bold tracking-tight text-foreground">{brand.shortName}</span>
            {nameLines.length > 0 && (
              <span className="text-sm text-[var(--text-secondary)] text-center leading-tight">
                {nameLines.map((line, i) => (
                  <span key={line}>
                    {i > 0 && <br />}
                    {line}
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>

        <div className="w-16 h-px bg-gradient-to-r from-transparent via-[var(--border-color)] to-transparent" />

        {demo && !access ? (
          <>
            <div className="text-center">
              <h1 className="text-lg font-semibold text-foreground">Try Lumilex</h1>
              <p className="text-sm text-[var(--text-secondary)] mt-1">
                Tell us who you are and you are signed in to a fictional firm. Nothing you do reaches
                a real person, and everything resets overnight.
              </p>
            </div>
            <DemoAccessForm
              personas={demo.personas.map((p) => ({ key: p.key, label: DEMO_PERSONA_COPY[p.key].label, name: p.name }))}
              selected={isDemoPersonaKey(as) ? as : undefined}
              invalid={invalid ? invalid.split(',') : []}
            />
            <details className="w-full text-sm">
              <summary className="cursor-pointer text-xs text-[var(--text-muted)] text-center hover:text-foreground">
                Sign in with a password
              </summary>
              <div className="mt-4">
                <LoginForm />
              </div>
            </details>
          </>
        ) : demo ? (
          <>
            <div className="text-center">
              <h1 className="text-lg font-semibold text-foreground">Try Lumilex</h1>
              <p className="text-sm text-[var(--text-secondary)] mt-1">
                Pick a role to explore a fictional firm. Nothing you do reaches a real person, and
                everything resets overnight.
              </p>
            </div>

            <div className="w-full flex flex-col gap-2">
              {demo.personas.map((p) => (
                // A plain link, not next/link: following it signs the visitor
                // in, which is not something to prefetch.
                <a
                  key={p.key}
                  href={`/api/auth/demo?as=${p.key}`}
                  className="group w-full flex items-center gap-3 rounded-xl border border-[var(--border-color)] bg-subtle hover:border-gold-400 hover:bg-gold-400/5 px-4 py-3 text-left transition-all"
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-foreground">
                      {DEMO_PERSONA_COPY[p.key].label}
                      <span className="font-normal text-[var(--text-muted)]">
                        {' '}· {p.name}{p.position ? `, ${p.position}` : ''}
                      </span>
                    </span>
                    <span className="block text-xs text-[var(--text-secondary)] mt-0.5">
                      {DEMO_PERSONA_COPY[p.key].blurb}
                    </span>
                  </span>
                  <ArrowRight className="w-4 h-4 shrink-0 text-[var(--text-muted)] group-hover:text-gold-500 transition-colors" />
                </a>
              ))}
            </div>

            <details className="w-full text-sm">
              <summary className="cursor-pointer text-xs text-[var(--text-muted)] text-center hover:text-foreground">
                Sign in with a password
              </summary>
              <div className="mt-4">
                <LoginForm />
              </div>
            </details>
          </>
        ) : (
          <>
            <div className="text-center">
              <h1 className="text-lg font-semibold text-foreground">Lumilex</h1>
              <p className="text-sm text-[var(--text-secondary)] mt-1">Sign in with your email and password.</p>
            </div>

            {error === 'CredentialsSignin' && (
              <div className="w-full text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-lg px-3 py-2 text-center">
                Invalid email or password.
              </div>
            )}

            <LoginForm />

            <p className="text-xs text-[var(--text-muted)] text-center">
              {firmName
                ? `Access is restricted to ${firmName} workspace members.`
                : 'Access is restricted to invited workspace members.'}
            </p>
          </>
        )}
        <SourceLink className="text-[11px] text-[var(--text-muted)] hover:text-foreground transition-colors" />
      </div>
    </main>
  );
}
