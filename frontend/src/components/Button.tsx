import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

export type ButtonVariant = 'primary' | 'secondary' | 'text' | 'link' | 'danger';
export type ButtonSize = 'sm' | 'compact' | 'md' | 'lg' | 'inline' | 'bare';

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border-none bg-accent-solid text-white font-medium hover:bg-accent-solid-hover disabled:hover:bg-accent-solid',
  secondary:
    'border border-border bg-bg-secondary text-text-primary font-medium hover:bg-bg-tertiary hover:border-border-hover disabled:hover:bg-bg-secondary disabled:hover:border-border',
  text: 'border-none bg-transparent text-accent font-medium hover:text-accent-hover disabled:hover:text-accent',
  link: 'border-none bg-transparent text-text-secondary font-normal hover:text-text-primary disabled:hover:text-text-secondary',
  danger:
    'border-none bg-red-600 text-white font-medium hover:bg-red-700 disabled:hover:bg-red-600',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm rounded-lg',
  compact: 'px-3 py-2 text-sm rounded-lg',
  md: 'px-4 py-2 text-sm rounded-lg',
  lg: 'px-6 py-3 text-base rounded-lg',
  inline: 'px-4 py-2 text-base rounded-md',
  bare: 'p-0 text-sm rounded-none',
};

interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

function buttonClassName({
  variant = 'primary',
  size = 'md',
  className = '',
}: ButtonStyleOptions = {}) {
  return [
    'inline-flex items-center justify-center no-underline cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
    variantClasses[variant],
    sizeClasses[size],
    className,
  ]
    .filter(Boolean)
    .join(' ');
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className, type = 'button', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClassName({ variant, size, className })}
      {...props}
    />
  );
});

export interface ButtonLinkProps extends Omit<LinkProps, 'className' | 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <Link className={buttonClassName({ variant, size, className })} {...props}>
      {children}
    </Link>
  );
}
