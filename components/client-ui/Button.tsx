import Link from 'next/link';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

interface Common {
  variant?: Variant;
  size?: Size;
  icon?: React.ReactNode;
  /** Shows a spinner in place of the icon and disables the control. */
  busy?: boolean;
  block?: boolean;
  className?: string;
  children: React.ReactNode;
}

type ButtonProps = Common &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'> & { href?: undefined };

type LinkProps = Common &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'children' | 'className' | 'href'> & {
    href: string;
    /** Plain <a> (downloads, new tabs); defaults to a Next.js Link. */
    external?: boolean;
    disabled?: boolean;
  };

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-navy-900 text-white hover:bg-navy-800 dark:bg-gold-400 dark:text-navy-950 dark:hover:bg-gold-300 shadow-[var(--shadow-card)]',
  secondary:
    'border border-[var(--border-color)] bg-card text-foreground hover:bg-subtle hover:border-[var(--border-hover)]',
  ghost: 'text-[var(--text-secondary)] hover:text-foreground hover:bg-subtle',
};

const SIZE: Record<Size, string> = {
  sm: 'text-xs px-3 py-1.5 gap-1.5 rounded-lg [&_svg]:w-3.5 [&_svg]:h-3.5',
  md: 'text-sm px-4 py-2.5 gap-2 rounded-xl [&_svg]:w-4 [&_svg]:h-4',
  lg: 'text-sm px-5 py-3 gap-2 rounded-xl [&_svg]:w-4 [&_svg]:h-4',
};

const BASE =
  'inline-flex items-center justify-center font-semibold whitespace-nowrap transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none';

/**
 * Every call to action on a client-facing screen. Three weights, three sizes,
 * and a link form so a download and a submit look like the same family.
 */
export default function ClientButton(props: ButtonProps | LinkProps) {
  const { variant = 'primary', size = 'md', icon, busy = false, block = false, className = '', children } = props;
  const cls = `${BASE} ${VARIANT[variant]} ${SIZE[size]} ${block ? 'w-full' : ''} ${className}`;
  const inner = (
    <>
      {busy ? <Loader2 className="animate-spin" /> : icon}
      {children}
    </>
  );

  if (props.href !== undefined) {
    const { href, external, disabled, ...rest } = stripCommon(props);
    if (disabled) {
      return (
        <span aria-disabled className={`${cls} opacity-50 cursor-not-allowed`} title={rest.title}>
          {inner}
        </span>
      );
    }
    if (external) {
      return (
        <a href={href} className={cls} {...rest}>
          {inner}
        </a>
      );
    }
    return (
      <Link href={href} className={cls} {...rest}>
        {inner}
      </Link>
    );
  }

  const { disabled, type = 'button', ...rest } = stripCommon(props);
  return (
    <button type={type} className={cls} disabled={disabled || busy} {...rest}>
      {inner}
    </button>
  );
}

/** Everything but the presentational props, so the rest can spread onto the element. */
function stripCommon<T extends Common>(props: T): Omit<T, keyof Common> {
  const rest = { ...props } as Partial<Common> & Omit<T, keyof Common>;
  delete rest.variant;
  delete rest.size;
  delete rest.icon;
  delete rest.busy;
  delete rest.block;
  delete rest.className;
  delete rest.children;
  return rest;
}
