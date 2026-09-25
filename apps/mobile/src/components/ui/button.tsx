import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-normal break-words rounded-xl text-center text-sm font-semibold transition-[transform,background-color,opacity,box-shadow] duration-150 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-45 active:scale-[0.98]',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--app-primary)] text-white shadow-[0_10px_24px_rgb(49_87_213_/_18%)] hover:bg-[var(--app-primary-strong)]',
        destructive:
          'bg-[var(--app-danger)] text-white shadow-[0_10px_24px_rgb(195_60_78_/_16%)] hover:brightness-95',
        outline:
          'bg-[var(--app-surface)] text-[var(--app-foreground)] hover:bg-[var(--app-surface-muted)]',
        ghost:
          'text-[var(--app-muted)] hover:bg-[var(--app-surface-muted)] hover:text-[var(--app-foreground)]',
      },
      size: {
        default: 'min-h-11 px-4 py-2.5',
        sm: 'min-h-9 rounded-lg px-3 py-2 text-xs',
        lg: 'min-h-14 px-5 py-3 text-base',
        icon: 'size-11 rounded-full p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
