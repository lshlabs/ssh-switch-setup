import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

type DialogAction = {
  label: string;
  onClick?: () => void;
  close?: boolean;
  submit?: boolean;
  disabled?: boolean;
};

/** Settings dialog geometry, with focus management and a complete exit animation. */
export function PreferenceDialog({
  title,
  children,
  actions,
  onClose,
  onSubmit,
  closeRef,
  returnFocusRef,
  busy = false,
  editing = false,
  variant = 'default',
  className,
}: {
  title: string;
  children: ReactNode;
  actions: DialogAction[];
  onClose: () => void;
  onSubmit?: () => void;
  closeRef?: RefObject<(() => void) | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  busy?: boolean;
  editing?: boolean;
  variant?: 'default' | 'confirm';
  className?: string | undefined;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLFormElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onCloseRef = useRef(onClose);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const close = useCallback(
    (afterClose?: () => void) => {
      if (busy || timerRef.current !== undefined) return;
      setClosing(true);
      const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 300;
      timerRef.current = setTimeout(() => {
        onCloseRef.current();
        afterClose?.();
      }, duration);
    },
    [busy],
  );

  useEffect(() => {
    if (closeRef) closeRef.current = close;
    return () => {
      if (closeRef) closeRef.current = null;
    };
  }, [close, closeRef]);

  useEffect(() => {
    const trigger =
      returnFocusRef?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current
      ?.querySelector<HTMLElement>('input, button:not(:disabled)')
      ?.focus({ preventScroll: true });
    return () => {
      clearTimeout(timerRef.current);
      document.body.style.overflow = previousOverflow;
      // The parent removes inert from the page in the same commit.
      requestAnimationFrame(() => {
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      });
    };
  }, [returnFocusRef]);

  return (
    <div
      className={`preferences-dialog-backdrop${closing ? ' is-closing' : ''}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        if (event.key !== 'Tab') return;
        const items = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'input:not(:disabled), button:not(:disabled), textarea:not(:disabled)',
          ) ?? [],
        );
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <form
        ref={dialogRef}
        role={variant === 'confirm' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
        className={`preferences-dialog ${className ?? 'onboarding-dialog'}${variant === 'confirm' ? ' preferences-dialog-confirm' : ''}${editing ? ' preferences-dialog-edit onboarding-dialog-edit' : ''}${closing ? ' is-closing' : ''}`}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && !closing) onSubmit?.();
        }}
      >
        <div className="preferences-dialog-title-area">
          <h2 id={titleId}>{title}</h2>
        </div>
        <div
          className={`preferences-dialog-content${editing ? ' preferences-dialog-edit-scroll' : variant === 'confirm' ? ' preferences-dialog-confirm-copy' : ' onboarding-dialog-copy'}`}
        >
          {children}
        </div>
        <div className="preferences-dialog-actions">
          {actions.map((action, index) => (
            <Fragment key={action.label}>
              {index > 0 && (
                <span className="preferences-dialog-action-divider" aria-hidden="true" />
              )}
              <button
                type={action.submit ? 'submit' : 'button'}
                className="preferences-dialog-action"
                disabled={busy || closing || action.disabled}
                onClick={() => {
                  if (action.close) close(action.onClick);
                  else action.onClick?.();
                }}
              >
                <span>{action.label}</span>
              </button>
            </Fragment>
          ))}
        </div>
      </form>
    </div>
  );
}
