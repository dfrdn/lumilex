'use client';

import { useState } from 'react';
import { Mail, Send, AlertCircle, CheckCircle2 } from 'lucide-react';
import { getSupabaseBrowserAuthClient } from '@/lib/supabase-browser';

export default function PortalLoginForm() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;

    setError('');
    setSubmitting(true);

    const supabase = getSupabaseBrowserAuthClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: `${window.location.origin}/portal/auth/callback`,
        shouldCreateUser: false,
      },
    });

    if (otpError) {
      const isRate = otpError.status === 429 || /rate|after \d+ seconds/i.test(otpError.message);
      setError(
        isRate
          ? 'A sign-in link was just sent. Wait a minute and try again.'
          : "We couldn't send a sign-in link to that address.",
      );
      setSubmitting(false);
      return;
    }

    setSent(true);
    setSubmitting(false);
  }

  if (sent) {
    return (
      <div className="w-full text-center space-y-3 py-4">
        <div className="mx-auto w-10 h-10 rounded-full bg-green-50 dark:bg-green-500/10 flex items-center justify-center">
          <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Check your email</p>
          <p className="text-xs text-[var(--text-secondary)] mt-1">We sent a sign-in link to {email}.</p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-4">
      <div className="relative">
        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
        <input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          required
          className="w-full pl-10 pr-4 py-3 text-sm rounded-xl border border-[var(--border-color)] bg-subtle placeholder:text-[var(--text-muted)] text-foreground focus:outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-400/20 hover:border-[var(--border-hover)] transition-all disabled:opacity-50"
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !email}
        className="w-full flex items-center justify-center gap-2 bg-navy-900 dark:bg-gold-400 hover:bg-navy-800 dark:hover:bg-gold-300 text-white dark:text-navy-950 font-semibold text-sm py-3 rounded-xl transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)]"
      >
        {submitting ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 dark:border-navy-900/30 border-t-white dark:border-t-navy-900 rounded-full animate-spin" />
            Sending...
          </>
        ) : (
          <>
            <Send className="w-4 h-4" />
            Email me a link
          </>
        )}
      </button>
    </form>
  );
}
