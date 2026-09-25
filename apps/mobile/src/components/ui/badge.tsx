import { cva, type VariantProps } from 'class-variance-authority';
import { type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
  {
    variants: {
      variant: {
        neutral: 'border-app bg-[var(--app-surface-muted)] text-[var(--app-muted)]',
        success: 'border-transparent bg-[var(--app-success-soft)] text-[var(--app-success)]',
        warning: 'border-transparent bg-[var(--app-warning-soft)] text-[var(--app-warning)]',
        danger: 'border-transparent bg-[var(--app-danger-soft)] text-[var(--app-danger)]',
        primary: 'border-transparent bg-[var(--app-primary-soft)] text-[var(--app-primary-strong)]',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
