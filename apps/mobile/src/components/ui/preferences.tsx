import { useRef, useState, type PointerEvent, type ReactNode, type Ref } from 'react';
import { settingsIcons, type SettingsIconName } from './settings-icons';

type RippleState = {
  id: number;
  x: number;
  y: number;
  size: number;
  isReleasing: boolean;
};

function PreferenceIcon({ name }: { name: SettingsIconName }) {
  const icon = settingsIcons[name];

  return (
    <svg className="preferences-icon" viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r="14" fill={icon.color} />
      {icon.paths.map((path) => (
        <path key={path} d={path} fill="var(--oui-on-color)" />
      ))}
    </svg>
  );
}

function useRipple() {
  const [ripple, setRipple] = useState<RippleState | null>(null);
  const rippleId = useRef(0);

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const size = 2 * Math.hypot(Math.max(x, bounds.width - x), Math.max(y, bounds.height - y));

    setRipple({
      id: rippleId.current++,
      x,
      y,
      size,
      isReleasing: false,
    });

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const releaseRipple = () => {
    setRipple((current) => (current === null ? null : { ...current, isReleasing: true }));
  };

  const clearRipple = (id: number) => {
    setRipple((current) => (current?.id === id && current.isReleasing ? null : current));
  };

  return { ripple, handlePointerDown, releaseRipple, clearRipple };
}

function Ripple({
  ripple,
  onReleaseEnd,
}: {
  ripple: RippleState | null;
  onReleaseEnd: (id: number) => void;
}) {
  if (ripple === null) {
    return null;
  }

  return (
    <span
      key={ripple.id}
      className={`preferences-ripple${ripple.isReleasing ? ' is-releasing' : ''}`}
      style={{
        height: ripple.size,
        left: ripple.x,
        top: ripple.y,
        width: ripple.size,
      }}
      onAnimationEnd={(event) => {
        if (
          event.target === event.currentTarget &&
          event.animationName === 'preferences-ripple-release' &&
          ripple.isReleasing
        ) {
          onReleaseEnd(ripple.id);
        }
      }}
      aria-hidden="true"
    />
  );
}

export function PreferenceToolbar({
  title,
  backLabel,
  onBack,
  action,
  decorative = false,
}: {
  title: string;
  backLabel: string;
  onBack: () => void;
  action?: ReactNode;
  decorative?: boolean;
}) {
  return (
    <header className="preferences-toolbar" aria-hidden={decorative || undefined}>
      <button
        type="button"
        className="preferences-toolbar-back preferences-toolbar-back-button"
        aria-label={decorative ? undefined : backLabel}
        tabIndex={decorative ? -1 : undefined}
        onClick={decorative ? undefined : onBack}
      >
        <svg className="preferences-toolbar-back-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="m15 5-7 7 7 7"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </svg>
      </button>
      <h1 className="preferences-toolbar-title">{title}</h1>
      {action && <div className="preferences-toolbar-action">{action}</div>}
    </header>
  );
}

export function PreferenceSection({
  title,
  children,
  className,
}: {
  title?: string | undefined;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`preference-section${className ? ` ${className}` : ''}`}>
      {title && <h2 className="preference-section-title">{title}</h2>}
      <div className="preference-section-card">{children}</div>
    </section>
  );
}

export function PreferenceRow({
  detailPage,
  icon,
  title,
  summary,
  onClick,
  tabIndex,
  disabled = false,
  buttonRef,
  className,
}: {
  detailPage?: string;
  icon: SettingsIconName;
  title: string;
  summary?: string;
  onClick: () => void;
  tabIndex?: number;
  disabled?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  className?: string;
}) {
  const { ripple, handlePointerDown, releaseRipple, clearRipple } = useRipple();

  return (
    <button
      type="button"
      ref={buttonRef}
      className={`preferences-row${className ? ` ${className}` : ''}`}
      onPointerDown={disabled ? undefined : handlePointerDown}
      onPointerUp={releaseRipple}
      onPointerCancel={releaseRipple}
      data-settings-detail-page={detailPage}
      tabIndex={tabIndex}
      disabled={disabled}
      onClick={onClick}
    >
      <Ripple ripple={ripple} onReleaseEnd={clearRipple} />
      <span className="preferences-icon-frame">
        <PreferenceIcon name={icon} />
      </span>
      <span className="preferences-copy">
        <b className="preferences-title">{title}</b>
        {summary && <small className="preferences-summary">{summary}</small>}
      </span>
      <span className="preferences-divider" aria-hidden="true" />
    </button>
  );
}

export function PreferenceValueRow({
  label,
  value,
  onClick,
  mono = false,
  error,
}: {
  label: string;
  value: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  mono?: boolean;
  error?: string | undefined;
}) {
  const { ripple, handlePointerDown, releaseRipple, clearRipple } = useRipple();

  return (
    <button
      type="button"
      className="preferences-option-row"
      onPointerDown={handlePointerDown}
      onPointerUp={releaseRipple}
      onPointerCancel={releaseRipple}
      onClick={onClick}
    >
      <Ripple ripple={ripple} onReleaseEnd={clearRipple} />
      <span className="preferences-option-row-copy">
        <b className="preferences-option-row-title">{label}</b>
        <small className={`preferences-option-row-summary${mono ? ' font-mono' : ''}`}>
          {value}
        </small>
        {error && (
          <small className="preferences-option-row-error" role="alert">
            {error}
          </small>
        )}
      </span>
    </button>
  );
}

export function PreferenceStatusRow({
  label,
  description,
  descriptionTone = 'neutral',
  mono = false,
}: {
  label: string;
  description?: string;
  descriptionTone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  mono?: boolean;
}) {
  return (
    <div className="preference-status-row">
      <div className="preference-status-layout">
        <div className="preference-row-copy">
          <p className="preference-row-label">{label}</p>
          {description && (
            <p
              className={`preference-row-description preference-row-description--${descriptionTone}${mono ? ' font-mono' : ''}`}
            >
              {description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function PreferenceActionRow({
  label,
  description,
  descriptionTone = 'neutral',
  mono = false,
  disabled = false,
  onClick,
}: {
  label: string;
  description: string;
  descriptionTone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  mono?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const { ripple, handlePointerDown, releaseRipple, clearRipple } = useRipple();

  return (
    <button
      type="button"
      className="preference-action-row"
      disabled={disabled}
      onClick={onClick}
      onPointerDown={disabled ? undefined : handlePointerDown}
      onPointerUp={releaseRipple}
      onPointerCancel={releaseRipple}
    >
      <Ripple ripple={ripple} onReleaseEnd={clearRipple} />
      <span className="preference-action-copy preference-row-copy">
        <span className="preference-row-label">{label}</span>
        <span
          className={`preference-row-description preference-row-description--${descriptionTone}${mono ? ' font-mono' : ''}`}
        >
          {description}
        </span>
      </span>
    </button>
  );
}

export function PreferenceToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const { ripple, handlePointerDown, releaseRipple, clearRipple } = useRipple();

  return (
    <button
      type="button"
      className="preferences-toggle-row"
      onPointerDown={handlePointerDown}
      onPointerUp={releaseRipple}
      onPointerCancel={releaseRipple}
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
    >
      <Ripple ripple={ripple} onReleaseEnd={clearRipple} />
      <span className="preferences-toggle-copy">
        <b className="preferences-option-row-title">{label}</b>
        <small className="preferences-option-row-summary">{description}</small>
      </span>
      <span className="preferences-toggle-control" aria-hidden="true">
        <span className={`preferences-switch${checked ? ' is-on' : ''}`}>
          <span className="preferences-switch-thumb">
            <span className="preferences-switch-highlight" />
            <span className="preferences-switch-thumb-fill" />
          </span>
        </span>
      </span>
    </button>
  );
}
