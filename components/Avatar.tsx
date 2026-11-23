import { ReactNode } from 'react';

interface Props {
  avatarUrl?: string | null;
  initials: string;
  name?: string;
  size?: number; // pixels
  className?: string;
  fallbackClassName?: string;
  ring?: boolean;
  title?: string;
  children?: ReactNode; // optional overlay (badge, status dot, etc.)
}

export default function Avatar({
  avatarUrl,
  initials,
  name,
  size = 28,
  className = '',
  fallbackClassName = 'bg-[var(--subtle-bg)] text-[var(--text-muted)]',
  ring = false,
  title,
  children,
}: Props) {
  const ringCls = ring ? 'ring-2 ring-[var(--border-color)]' : '';
  const base = `shrink-0 rounded-full overflow-hidden flex items-center justify-center ${ringCls} ${className}`;
  const style = { width: size, height: size };
  const fontSize = Math.max(9, Math.round(size * 0.4));

  if (avatarUrl) {
    return (
      <span className={base} style={style} title={title || name}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl}
          alt={name || initials}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        {children}
      </span>
    );
  }

  return (
    <span
      className={`${base} font-semibold ${fallbackClassName}`}
      style={{ ...style, fontSize }}
      title={title || name}
    >
      {initials || '?'}
      {children}
    </span>
  );
}
