import type { ComponentPropsWithRef } from 'react';

export type ButtonProps = ComponentPropsWithRef<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost';
};

export function Button({
  variant = 'primary',
  type = 'button',
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button {...props} type={type} className={`cm-button cm-button--${variant} ${className}`} />
  );
}

export function Input({ className = '', ...props }: ComponentPropsWithRef<'input'>) {
  return <input {...props} className={`cm-input ${className}`} />;
}

export function Card({ className = '', ...props }: ComponentPropsWithRef<'section'>) {
  return <section {...props} className={`cm-card ${className}`} />;
}

export function Navigation({ className = '', ...props }: ComponentPropsWithRef<'nav'>) {
  return <nav {...props} className={`cm-navigation ${className}`} />;
}

export type NavigationLinkProps = Omit<ComponentPropsWithRef<'a'>, 'href' | 'aria-current'> & {
  href: string;
  current?: boolean;
};

export function NavigationLink({ current = false, className = '', ...props }: NavigationLinkProps) {
  return (
    <a
      {...props}
      aria-current={current ? 'page' : undefined}
      className={`cm-navigation-link ${className}`}
    />
  );
}
