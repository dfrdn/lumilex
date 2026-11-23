'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from '@/components/SessionProvider';
import { useTheme } from 'next-themes';
import {
  Sun, Moon, Monitor, Lock, Eye, EyeOff, Bell, BellOff,
  Calendar, Gavel, FileText, CheckCircle, AlertCircle, RefreshCw,
  User, Users, Mail, Inbox, Activity, Smartphone, MessageSquare,
  Camera, Trash2, Check, Crop, Send, Copy, Link2,
} from 'lucide-react';
import AvatarCropModal from './AvatarCropModal';
import { useSearchParams } from 'next/navigation';
import { Settings } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import TabLabel from '@/components/ui/TabLabel';
import { SETTINGS_TABS, isInPlaceClick, parseSettingsTab, settingsTabHref, switchSettingsTab, type SettingsTab } from '@/lib/settings/tabs';

interface Profile {
  name: string;
  email: string;
  position: string;
  role: string;
  startDate: string | null;
  initials: string;
  nickname: string;
  avatar: string | null;
  headshot: string | null;
}

interface Features {
  push: boolean;
}

interface Preferences {
  notify_deadlines: boolean;
  notify_hearings: boolean;
  notify_new_deliverables: boolean;
  notify_meetings: boolean;
  notify_email_briefer: boolean;
  notify_emails: boolean;
  notify_deliverable_transfer_email: boolean;
  notify_meeting_attendee_email: boolean;
  notify_hearing_attendee_email: boolean;
  notify_status_changes_watching: boolean;
  notify_push_enabled: boolean;
  notify_chat: boolean;
}

const ROLE_COLORS: Record<string, string> = {
  super_user: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300',
  partner: 'bg-gold-100 text-gold-700 dark:bg-gold-500/20 dark:text-gold-300',
  lawyer: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  admin: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300',
  finance: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
};

const ROLE_LABELS: Record<string, string> = {
  super_user: 'Super User',
  partner: 'Partner',
  lawyer: 'Lawyer',
  admin: 'Admin',
  finance: 'Finance',
};

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) view[i] = rawData.charCodeAt(i);
  return buffer;
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/**
 * A person's own Settings, one tab at a time (`?tab=`, lib/settings/tabs.ts),
 * under `basePath`: /dashboard/settings, or /liaison/settings in the liaison shell.
 *
 * Tabs switch in place (`switchSettingsTab`): a server navigation to another
 * `?tab=` remounts the page, and Back then restores the payload rendered
 * before any edit. A tab once opened stays mounted, hidden, so what was saved
 * on it is still there on returning.
 */
export default function SettingsPageClient({
  profile,
  features,
  tab: initialTab,
  basePath,
}: {
  profile: Profile;
  features: Features;
  tab: SettingsTab;
  basePath: string;
}) {
  const searchParams = useSearchParams();
  const tab = searchParams ? parseSettingsTab(searchParams.getAll('tab')) : initialTab;
  const [opened, setOpened] = useState<ReadonlySet<SettingsTab>>(() => new Set([tab]));
  if (!opened.has(tab)) setOpened(new Set([...opened, tab]));

  const panel = (key: SettingsTab, children: React.ReactNode) =>
    opened.has(key) && (
      <div hidden={tab !== key} className="space-y-6">
        {children}
      </div>
    );

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-2xl mx-auto space-y-6">
      <div>
        <PageHeader icon={<Settings className="w-5 h-5" />} title="Settings" />
        <SettingsTabs tab={tab} basePath={basePath} />
      </div>
      <div>
        {panel('profile', (
          <>
            <ProfileCard profile={profile} />
            <HeadshotCard profile={profile} />
            <ThemePreference />
          </>
        ))}
        {panel('notifications', <NotificationPrefs push={features.push} />)}
        {panel('calendar', <CalendarFeedCard />)}
        {panel('security', (
          <>
            <ChangePasswordForm />
            <SessionInfo profile={profile} />
          </>
        ))}
      </div>
    </div>
  );
}

/** A link to another Settings tab that switches in place; a modified click still opens a new tab. */
function TabLink({ href, onClick, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      {...rest}
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || !isInPlaceClick(e)) return;
        e.preventDefault();
        switchSettingsTab(href);
      }}
    />
  );
}

const TAB_GROUP = 'inline-flex p-0.5 rounded-lg bg-stone-100 dark:bg-white/[0.06] text-xs';
const TAB_SEGMENT = 'press shrink-0 px-3 py-1 rounded-md transition-all whitespace-nowrap';
const TAB_ON = 'bg-white dark:bg-card shadow-sm text-stone-900 dark:text-stone-50 font-medium';
const TAB_OFF = 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-100';

/** Profile, Notifications, Calendar feed, Security: each a link, so the tab lives in the URL. */
function SettingsTabs({ tab, basePath }: { tab: SettingsTab; basePath: string }) {
  return (
    <div className="-mx-1 px-1 -mt-2 overflow-x-auto">
      <nav className={TAB_GROUP} aria-label="Settings sections">
        {SETTINGS_TABS.map((t) => (
          <TabLink
            key={t.key}
            href={settingsTabHref(basePath, t.key)}
            aria-current={tab === t.key ? 'page' : undefined}
            className={`${TAB_SEGMENT} ${tab === t.key ? TAB_ON : TAB_OFF}`}
          >
            <TabLabel label={t.label} />
          </TabLink>
        ))}
      </nav>
    </div>
  );
}

/* ── Profile Card ──────────────────────────────────────────── */
function ProfileCard({ profile }: { profile: Profile }) {
  const { update: refreshSession } = useSession();
  const [avatar, setAvatar] = useState(profile.avatar);
  const [nickname, setNickname] = useState(profile.nickname ?? '');
  const [nicknameSaved, setNicknameSaved] = useState(false);
  const [nicknameSaving, setNicknameSaving] = useState(false);
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const saveNickname = useCallback(async (value: string) => {
    const next = value.trim();
    if (next === (profile.nickname ?? '').trim() && next === nickname.trim()) return;
    setNicknameSaving(true);
    setNicknameError(null);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save');
      }
      setNicknameSaved(true);
      setTimeout(() => setNicknameSaved(false), 1800);
      refreshSession();
    } catch (err) {
      setNicknameError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setNicknameSaving(false);
    }
  }, [nickname, profile.nickname, refreshSession]);

  const onPickFile = useCallback((file: File) => {
    setAvatarError(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setCropSrc(reader.result);
    };
    reader.onerror = () => setAvatarError('Could not read image');
    reader.readAsDataURL(file);
  }, []);

  const onUploadCrop = useCallback(async (blob: Blob) => {
    setAvatarError(null);
    setAvatarBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
      const res = await fetch('/api/user/avatar', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setAvatar(data.avatar ?? null);
      setCropSrc(null);
      refreshSession();
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Upload failed');
      throw err;
    } finally {
      setAvatarBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [refreshSession]);

  const onRemove = useCallback(async () => {
    setAvatarError(null);
    setAvatarBusy(true);
    try {
      const res = await fetch('/api/user/avatar', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Remove failed');
      }
      setAvatar(null);
      refreshSession();
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setAvatarBusy(false);
    }
  }, [refreshSession]);

  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-5">
      <div className="flex items-center gap-4 mb-5">
        <div className="relative shrink-0">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatar}
              alt={profile.name}
              crossOrigin="anonymous"
              className="w-14 h-14 rounded-full object-cover ring-2 ring-[var(--border-color)]"
            />
          ) : (
            <div className="w-14 h-14 rounded-full bg-navy-100 dark:bg-navy-800 flex items-center justify-center text-lg font-semibold text-navy-600 dark:text-navy-300">
              {profile.initials}
            </div>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={avatarBusy}
            className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-navy-900 dark:bg-gold-400 text-white dark:text-navy-950 flex items-center justify-center shadow-sm hover:bg-navy-800 dark:hover:bg-gold-300 disabled:opacity-50 transition-colors"
            title="Change photo"
          >
            <Camera className="w-3 h-3" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPickFile(f);
            }}
          />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground truncate">{profile.name}</h2>
          <p className="text-sm text-[var(--text-secondary)] truncate">{profile.position}</p>
        </div>
        <span className={`ml-auto text-xs font-medium px-2.5 py-1 rounded-full ${ROLE_COLORS[profile.role] ?? ROLE_COLORS.lawyer}`}>
          {ROLE_LABELS[profile.role] ?? profile.role}
        </span>
      </div>

      {avatar && (
        <div className="mb-4 flex items-center gap-4 text-xs">
          <button
            type="button"
            onClick={() => setCropSrc(avatar)}
            disabled={avatarBusy}
            className="inline-flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-foreground disabled:opacity-50 transition-colors"
          >
            <Crop className="w-3.5 h-3.5" />
            Edit crop
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={avatarBusy}
            className="inline-flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Remove photo
          </button>
          {avatarBusy && <span className="text-[var(--text-muted)]">Working…</span>}
        </div>
      )}
      {avatarError && (
        <div className="mb-4 flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {avatarError}
        </div>
      )}

      <div className="mb-4">
        <label htmlFor="nickname-input" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
          Nickname
        </label>
        <div className="relative">
          <input
            id="nickname-input"
            type="text"
            value={nickname}
            placeholder="What should we call you?"
            maxLength={40}
            onChange={(e) => setNickname(e.target.value)}
            onBlur={(e) => saveNickname(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            disabled={nicknameSaving}
            className="w-full pr-9 px-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--background)] placeholder:text-[var(--text-muted)] text-foreground focus:outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-400/20 transition-all disabled:opacity-50"
          />
          {nicknameSaved && (
            <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
          )}
        </div>
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          Used in your dashboard greeting and email notifications. Leave blank to use your first name.
        </p>
        {nicknameError && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">{nicknameError}</p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <InfoField icon={<User className="w-3.5 h-3.5" />} label="Email" value={profile.email} />
        <InfoField icon={<Calendar className="w-3.5 h-3.5" />} label="Member since" value={profile.startDate ? new Date(profile.startDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'N/A'} />
      </div>

      {cropSrc && (
        <AvatarCropModal
          imageSrc={cropSrc}
          onCancel={() => {
            if (!avatarBusy) {
              setCropSrc(null);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }
          }}
          onCropComplete={onUploadCrop}
        />
      )}
    </div>
  );
}

/* ── Client Portal Headshot ────────────────────────────────── */
function HeadshotCard({ profile }: { profile: Profile }) {
  const [headshot, setHeadshot] = useState(profile.headshot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onPickFile = useCallback((file: File) => {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setCropSrc(reader.result);
    };
    reader.onerror = () => setError('Could not read image');
    reader.readAsDataURL(file);
  }, []);

  const onUploadCrop = useCallback(async (blob: Blob) => {
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', new File([blob], 'headshot.jpg', { type: 'image/jpeg' }));
      const res = await fetch('/api/user/headshot', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setHeadshot(data.headshot ?? null);
      setCropSrc(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      throw err;
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, []);

  const onRemove = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/user/headshot', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Remove failed');
      }
      setHeadshot(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-5">
      <h3 className="text-sm font-semibold text-foreground">Client portal headshot</h3>
      <p className="text-xs text-[var(--text-muted)] mt-0.5 mb-4">
        Shown to clients on their portal&apos;s &ldquo;Your legal team&rdquo; card. Use your
        corporate headshot — your profile photo above stays internal. Without one, clients see
        your initials.
      </p>
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          {headshot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={headshot}
              alt={`${profile.name} headshot`}
              crossOrigin="anonymous"
              className="w-14 h-14 rounded-full object-cover ring-2 ring-[var(--border-color)]"
            />
          ) : (
            <div className="w-14 h-14 rounded-full bg-navy-100 dark:bg-navy-800 flex items-center justify-center text-lg font-semibold text-navy-600 dark:text-navy-300">
              {profile.initials}
            </div>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-navy-900 dark:bg-gold-400 text-white dark:text-navy-950 flex items-center justify-center shadow-sm hover:bg-navy-800 dark:hover:bg-gold-300 disabled:opacity-50 transition-colors"
            title="Change headshot"
          >
            <Camera className="w-3 h-3" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPickFile(f);
            }}
          />
        </div>
        {headshot && (
          <div className="flex items-center gap-4 text-xs">
            <button
              type="button"
              onClick={() => setCropSrc(headshot)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-foreground disabled:opacity-50 transition-colors"
            >
              <Crop className="w-3.5 h-3.5" />
              Edit crop
            </button>
            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              className="inline-flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Remove
            </button>
            {busy && <span className="text-[var(--text-muted)]">Working…</span>}
          </div>
        )}
      </div>
      {error && (
        <div className="mt-3 flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}
      {cropSrc && (
        <AvatarCropModal
          imageSrc={cropSrc}
          onCancel={() => {
            if (!busy) {
              setCropSrc(null);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }
          }}
          onCropComplete={onUploadCrop}
        />
      )}
    </div>
  );
}

function InfoField({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-[var(--text-muted)]">{icon}</span>
      <span className="text-[var(--text-muted)]">{label}:</span>
      <span className="text-foreground font-medium truncate">{value}</span>
    </div>
  );
}

/* ── Theme Preference ──────────────────────────────────────── */
function ThemePreference() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">Appearance</h3>
        <div className="h-10 bg-[var(--background)] rounded-lg animate-pulse" />
      </div>
    );
  }

  const options = [
    { key: 'light', label: 'Light', icon: Sun },
    { key: 'dark', label: 'Dark', icon: Moon },
    { key: 'system', label: 'System', icon: Monitor },
  ];

  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-5">
      <h3 className="text-sm font-semibold text-foreground mb-3">Appearance</h3>
      <div className="flex rounded-lg bg-[var(--background)] p-1 gap-1">
        {options.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTheme(key)}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-xs font-medium transition-all duration-200 ${
              theme === key
                ? 'bg-navy-900 dark:bg-gold-400 text-white dark:text-navy-950 shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-foreground'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Change Password Form ──────────────────────────────────── */
function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/user/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to change password');

      setSuccess('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const inputClass = 'w-full pl-10 pr-10 py-2.5 text-sm rounded-xl border border-[var(--border-color)] bg-[var(--background)] placeholder:text-[var(--text-muted)] text-foreground focus:outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-400/20 transition-all disabled:opacity-50';

  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-5">
      <h3 className="text-sm font-semibold text-foreground mb-4">Change Password</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Current Password */}
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type={showCurrent ? 'text' : 'password'}
            placeholder="Current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className={inputClass}
            disabled={loading}
            required
          />
          <button
            type="button"
            onClick={() => setShowCurrent(!showCurrent)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-foreground transition-colors"
          >
            {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {/* New Password */}
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type={showNew ? 'text' : 'password'}
            placeholder="New password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={inputClass}
            disabled={loading}
            required
          />
          <button
            type="button"
            onClick={() => setShowNew(!showNew)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-foreground transition-colors"
          >
            {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {/* Confirm Password */}
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type={showNew ? 'text' : 'password'}
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={inputClass}
            disabled={loading}
            required
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-lg px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {error}
          </div>
        )}

        {success && (
          <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 border border-green-100 dark:border-green-500/20 rounded-lg px-3 py-2">
            <CheckCircle className="w-3.5 h-3.5 shrink-0" />
            {success}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !currentPassword || !newPassword || !confirmPassword}
          className="w-full py-2.5 rounded-xl text-sm font-semibold bg-navy-900 dark:bg-gold-400 text-white dark:text-navy-950 hover:bg-navy-800 dark:hover:bg-gold-300 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {loading ? 'Changing...' : 'Change Password'}
        </button>
      </form>
    </div>
  );
}

/* ── Notification Preferences ──────────────────────────────── */
function NotificationPrefs({ push }: { push: boolean }) {
  const [prefs, setPrefs] = useState<Preferences>({
    notify_deadlines: true,
    notify_hearings: true,
    notify_new_deliverables: true,
    notify_meetings: true,
    notify_email_briefer: true,
    notify_emails: true,
    notify_deliverable_transfer_email: true,
    notify_meeting_attendee_email: true,
    notify_hearing_attendee_email: true,
    notify_status_changes_watching: false,
    notify_push_enabled: false,
    notify_chat: true,
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushTestState, setPushTestState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [mutes, setMutes] = useState<{ entity_id: string; label: string | null; created_at: string }[]>([]);

  useEffect(() => {
    fetch('/api/notifications/mutes')
      .then((r) => r.json())
      .then((d) => setMutes(d.mutes ?? []))
      .catch(() => {});
  }, []);

  const unmute = useCallback((entityId: string) => {
    setMutes((prev) => prev.filter((m) => m.entity_id !== entityId));
    fetch('/api/notifications/mutes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId }),
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/user/preferences')
      .then((r) => r.json())
      .then((data) => {
        setPrefs({
          notify_deadlines: data.notify_deadlines ?? true,
          notify_hearings: data.notify_hearings ?? true,
          notify_new_deliverables: data.notify_new_deliverables ?? true,
          notify_meetings: data.notify_meetings ?? true,
          notify_email_briefer: data.notify_email_briefer ?? true,
          notify_emails: data.notify_emails ?? true,
          notify_deliverable_transfer_email: data.notify_deliverable_transfer_email ?? true,
          notify_meeting_attendee_email: data.notify_meeting_attendee_email ?? true,
          notify_hearing_attendee_email: data.notify_hearing_attendee_email ?? true,
          notify_status_changes_watching: data.notify_status_changes_watching ?? false,
          notify_push_enabled: data.notify_push_enabled ?? false,
          notify_chat: data.notify_chat ?? true,
        });
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const persistPrefs = useCallback(async (next: Preferences): Promise<boolean> => {
    try {
      const res = await fetch('/api/user/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const togglePush = useCallback(async (nextEnabled: boolean) => {
    setPushError(null);
    if (nextEnabled) {
      if (typeof window === 'undefined'
        || !('serviceWorker' in navigator)
        || !('PushManager' in window)) {
        setPushError('This browser does not support push notifications.');
        return;
      }
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        setPushError('Push is not configured on this environment.');
        return;
      }
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setPushError('Notifications were blocked. Enable them in your browser settings and try again.');
          return;
        }
        const reg = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidKey),
          });
        }
        const res = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: sub.toJSON() }),
        });
        if (!res.ok) throw new Error('subscribe failed');
      } catch (err) {
        console.error('[push] enable failed', err);
        setPushError('Could not enable push notifications. Please try again.');
        return;
      }
    } else {
      try {
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.getRegistration('/sw.js');
          const sub = await reg?.pushManager.getSubscription();
          if (sub) {
            await fetch('/api/push/unsubscribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ endpoint: sub.endpoint }),
            }).catch(() => {});
            await sub.unsubscribe().catch(() => {});
          } else {
            await fetch('/api/push/unsubscribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
            }).catch(() => {});
          }
        }
      } catch (err) {
        console.error('[push] disable cleanup failed', err);
      }
    }

    const updated = { ...prefs, notify_push_enabled: nextEnabled };
    setPrefs(updated);
    setSaving(true);
    const ok = await persistPrefs(updated);
    if (!ok) setPrefs(prefs);
    setSaving(false);
  }, [prefs, persistPrefs]);

  const toggle = useCallback(async (key: keyof Preferences) => {
    if (key === 'notify_push_enabled') {
      await togglePush(!prefs[key]);
      return;
    }
    const updated = { ...prefs, [key]: !prefs[key] };
    setPrefs(updated); // Optimistic

    setSaving(true);
    const ok = await persistPrefs(updated);
    if (!ok) setPrefs(prefs);
    setSaving(false);
  }, [prefs, persistPrefs, togglePush]);

  const items = [
    { key: 'notify_deadlines' as const, label: 'Deadline reminders', desc: 'Get notified about upcoming deadlines', icon: Calendar },
    { key: 'notify_hearings' as const, label: 'Hearing alerts', desc: 'Get notified about upcoming hearings', icon: Gavel },
    { key: 'notify_new_deliverables' as const, label: 'New assignments', desc: 'Get notified about new deliverable assignments', icon: FileText },
    { key: 'notify_status_changes_watching' as const, label: 'Status changes on deliverables I\u2019m drafting or reviewing', desc: 'Get pinged when a deliverable you\u2019re drafting or reviewing changes status, even if it\u2019s not currently with you', icon: Activity },
    { key: 'notify_meetings' as const, label: 'Meeting reminders', desc: 'Get notified about upcoming meetings', icon: Users },
    { key: 'notify_email_briefer' as const, label: 'Daily email briefer', desc: 'Receive a morning summary of your day', icon: Mail },
    { key: 'notify_emails' as const, label: 'Email notifications', desc: 'Get notified when new emails are linked to your matters', icon: Inbox },
    { key: 'notify_deliverable_transfer_email' as const, label: 'Deliverable transfer emails', desc: 'Email me when a deliverable is transferred to me, or when I’m tagged in a submission comment', icon: Mail },
    { key: 'notify_meeting_attendee_email' as const, label: 'Meeting invite emails', desc: 'Email me when I’m added as an attendee on a new or existing meeting', icon: Mail },
    { key: 'notify_hearing_attendee_email' as const, label: 'Hearing invite emails', desc: 'Email me when I’m added as an attendee on a new or existing hearing', icon: Mail },
    ...(push
      ? [{ key: 'notify_push_enabled' as const, label: 'Browser push notifications', desc: 'Show a system notification on this device, even when the tab is closed', icon: Smartphone }]
      : []),
    { key: 'notify_chat' as const, label: 'Chat mentions & DMs', desc: 'Push @mentions in channels and every message in direct chats', icon: MessageSquare },
  ];

  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
      </div>

      {!loaded ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-[var(--background)] rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {items.map(({ key, label, desc, icon: Icon }) => (
            <div key={key}>
              <div className="flex items-center justify-between py-3 px-3 rounded-lg hover:bg-[var(--background)] transition-colors">
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4 text-[var(--text-muted)]" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{label}</p>
                    <p className="text-xs text-[var(--text-muted)]">{desc}</p>
                  </div>
                </div>
                <button
                  onClick={() => toggle(key)}
                  disabled={saving}
                  className={`relative w-10 h-5.5 rounded-full transition-colors duration-200 ${
                    prefs[key]
                      ? 'bg-navy-900 dark:bg-gold-400'
                      : 'bg-gray-300 dark:bg-gray-600'
                  } disabled:opacity-50`}
                  style={{ height: '22px' }}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white shadow-sm transition-transform duration-200 dark:bg-stone-900 ${
                      prefs[key] ? 'translate-x-[18px]' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              {key === 'notify_push_enabled' && prefs.notify_push_enabled && (
                <div className="flex items-center gap-2 px-3 pb-2">
                  <button
                    type="button"
                    onClick={async () => {
                      setPushTestState('sending');
                      try {
                        const res = await fetch('/api/push/test', { method: 'POST' });
                        setPushTestState(res.ok ? 'sent' : 'error');
                      } catch {
                        setPushTestState('error');
                      }
                      setTimeout(() => setPushTestState('idle'), 3000);
                    }}
                    disabled={pushTestState === 'sending'}
                    className="text-[11px] font-medium px-2.5 py-1 rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-foreground hover:bg-[var(--background)] transition-colors disabled:opacity-50"
                  >
                    {pushTestState === 'sending' ? 'Sending…' : 'Send test push'}
                  </button>
                  {pushTestState === 'sent' && (
                    <span className="text-[11px] text-emerald-500 dark:text-emerald-400">Sent — check your OS notifications.</span>
                  )}
                  {pushTestState === 'error' && (
                    <span className="text-[11px] text-red-500 dark:text-red-400">Could not send test. Try toggling the setting off and back on.</span>
                  )}
                </div>
              )}
              {key === 'notify_push_enabled' && pushError && (
                <p className="px-3 pb-2 text-xs text-red-500 dark:text-red-400">{pushError}</p>
              )}
            </div>
          ))}

          {mutes.length > 0 && (
            <div className="mt-5 pt-4 border-t border-[var(--border-color)]">
              <p className="text-sm font-medium text-foreground flex items-center gap-2">
                <BellOff className="w-4 h-4 text-[var(--text-muted)]" />
                Muted items
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5 mb-2 ml-6">
                You won’t get notifications about these. Unmute to resume.
              </p>
              <div className="space-y-1">
                {mutes.map((m) => (
                  <div
                    key={m.entity_id}
                    className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg hover:bg-[var(--background)] transition-colors"
                  >
                    <span className="text-sm text-foreground truncate">{m.label || m.entity_id}</span>
                    <button
                      type="button"
                      onClick={() => unmute(m.entity_id)}
                      className="shrink-0 text-[11px] font-medium px-2.5 py-1 rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-foreground hover:bg-[var(--background)] transition-colors"
                    >
                      Unmute
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


/* ── Session Info ──────────────────────────────────────────── */
function SessionInfo({ profile }: { profile: Profile }) {
  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-5">
      <h3 className="text-sm font-semibold text-foreground mb-3">Account Info</h3>
      <div className="space-y-2 text-sm">
        {profile.startDate && (
          <div className="flex items-center justify-between">
            <span className="text-[var(--text-secondary)]">Member since</span>
            <span className="text-foreground font-medium">
              {new Date(profile.startDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Calendar feed ─────────────────────────────────────────── */
interface FeedState {
  url: string | null;
  lastAccessedAt: string | null;
}

function CalendarFeedCard() {
  const [state, setState] = useState<FeedState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmingRotate, setConfirmingRotate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/me/calendar-feed')
      .then((r) => r.json())
      .then((d) => {
        if (active) setState(d);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const act = useCallback(async (action: 'create' | 'rotate') => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/me/calendar-feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Request failed');
      setState({ url: json.url, lastAccessedAt: null });
      setConfirmingRotate(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }, []);

  const revoke = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/me/calendar-feed', { method: 'DELETE' });
      if (!res.ok) throw new Error('Request failed');
      setState({ url: null, lastAccessedAt: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }, []);

  const copy = useCallback(async () => {
    if (!state?.url) return;
    await navigator.clipboard.writeText(state.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [state?.url]);

  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-5">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-foreground">Calendar feed</h3>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          Subscribe to your hearings, meetings, and deadlines from Outlook, Google Calendar,
          or Apple Calendar.
        </p>
      </div>

      {!loaded ? (
        <div className="h-20 bg-[var(--background)] rounded-lg animate-pulse" />
      ) : !state?.url ? (
        <button
          onClick={() => act('create')}
          disabled={busy}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-navy-900 text-white dark:bg-gold-400 dark:text-stone-900 disabled:opacity-50"
        >
          {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
          Create my feed link
        </button>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={state.url}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 px-3 py-2 text-xs font-mono rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-[var(--text-secondary)]"
            />
            <button
              onClick={copy}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-[var(--border-color)] hover:bg-[var(--background)] shrink-0"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Anyone with this link can read your calendar — hearings, matter names, and clients —
            without signing in. Don’t share it. If it gets out, replace it below.
            {state.lastAccessedAt
              ? ` Last fetched ${relativeTime(state.lastAccessedAt)}.`
              : ' Your calendar app may take a few hours to pick up changes.'}
          </p>

          <details className="text-xs text-[var(--text-muted)]">
            <summary className="cursor-pointer hover:text-foreground">How to subscribe</summary>
            <ul className="mt-2 space-y-1 pl-4 list-disc leading-relaxed">
              <li><strong>Outlook</strong>: Calendar → Add calendar → Subscribe from web → paste the link.</li>
              <li><strong>Google Calendar</strong>: Other calendars → + → From URL → paste the link.</li>
              <li><strong>Apple Calendar</strong>: File → New Calendar Subscription → paste the link.</li>
            </ul>
          </details>

          <div className="flex items-center gap-2 pt-1">
            {confirmingRotate ? (
              <>
                <button
                  onClick={() => act('rotate')}
                  disabled={busy}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white disabled:opacity-50"
                >
                  Replace it — everyone subscribed to the old link stops updating
                </button>
                <button
                  onClick={() => setConfirmingRotate(false)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border-color)]"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setConfirmingRotate(true)}
                  disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-color)] hover:bg-[var(--background)] disabled:opacity-50"
                >
                  <RefreshCw className="w-3 h-3" />
                  Replace link
                </button>
                <button
                  onClick={revoke}
                  disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50"
                >
                  <Trash2 className="w-3 h-3" />
                  Turn off
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-500 dark:text-red-400 flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5" />
          {error}
        </p>
      )}
    </div>
  );
}
