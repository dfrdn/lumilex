import Link from 'next/link';
import { BTN_SHAPE, BTN_TONE, type ButtonVariant } from './tone';

export type ButtonSize = 'sm' | 'md' | 'lg';

const SIZE: Record<ButtonSize, string> = {
  sm: 'text-xs px-3 py-1 rounded-full',
  md: 'text-xs px-3.5 py-1.5 rounded-full',
  lg: 'text-sm px-5 py-2 rounded-full',
};

/** The class string for a kit button, for the rare element that can't be a `Button`. */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className = ''): string {
  return `${BTN_SHAPE} ${SIZE[size]} ${BTN_TONE[variant]} ${className}`;
}

type Common = { variant?: ButtonVariant; size?: ButtonSize; className?: string; children: React.ReactNode };
type AsButton = Common & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & { href?: undefined; ref?: React.Ref<HTMLButtonElement> };
type AsLink = Common & Omit<React.ComponentProps<typeof Link>, 'className' | 'children'> & { href: string };

/** The kit's button. Pass `href` to render a link that looks the same. */
export default function Button(props: AsButton | AsLink) {
  if (props.href !== undefined) {
    const { variant, size, className, children, ...rest } = props;
    return (
      <Link {...rest} className={buttonClass(variant, size, className)}>
        {children}
      </Link>
    );
  }
  const { variant, size, className, children, type = 'button', ...rest } = props;
  return (
    <button {...rest} type={type} className={buttonClass(variant, size, className)}>
      {children}
    </button>
  );
}
