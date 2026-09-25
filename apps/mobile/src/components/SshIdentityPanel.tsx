import type { SshIdentityResult } from '@pc-control/capacitor-pc-control';
import { useAppCopy } from '../i18n';

export function SshIdentityPanel({
  identity,
  busy,
  mode,
  onEnsure,
  onCopy,
}: {
  identity: SshIdentityResult | undefined;
  busy: boolean;
  mode: 'onboarding' | 'settings';
  onEnsure: () => void;
  onCopy: () => void;
}) {
  const { t, copyMode } = useAppCopy();
  const key = mode === 'onboarding' ? 'onboarding.key' : 'settings.identity';
  const readyTitle = t(`${key}.${mode === 'onboarding' ? 'readyTitle' : 'ready'}`);
  const fingerprintLabel = t(
    mode === 'onboarding'
      ? 'diagnostics.security.identityFingerprint'
      : 'settings.identity.fingerprint',
  );
  const publicKeyLabel = t(
    mode === 'onboarding' ? 'onboarding.key.publicKeyLabel' : 'settings.identity.publicKey',
  );
  const copyLabel = t(`${key}.copy`);

  return identity?.available ? (
    <div className="surface mt-6 p-4 settings-identity-panel">
      <div className="settings-identity-status">
        <span>{mode === 'onboarding' ? readyTitle : t('settings.identity.status')}</span>
        {mode === 'settings' && <strong className="status-success">{readyTitle}</strong>}
      </div>
      {mode === 'settings' ? (
        <>
          <p className="settings-identity-label">{fingerprintLabel}</p>
          <p className="settings-identity-value font-mono">{identity.fingerprint}</p>
          <p className="settings-identity-label">{publicKeyLabel}</p>
          <textarea
            className="field settings-identity-public-key resize-none break-all font-mono text-xs"
            readOnly
            value={identity.publicKey ?? ''}
            aria-label={publicKeyLabel}
          />
        </>
      ) : (
        <>
          <p className="settings-identity-summary">{t('onboarding.key.readyDescription')}</p>
          <details className="settings-identity-details">
            <summary>{t('onboarding.key.details')}</summary>
            <p className="settings-identity-label">{fingerprintLabel}</p>
            <p className="settings-identity-value font-mono">{identity.fingerprint}</p>
            {copyMode === 'technical' && (
              <>
                <p className="settings-identity-label">{publicKeyLabel}</p>
                <p className="settings-identity-value settings-identity-raw font-mono">
                  {identity.publicKey}
                </p>
              </>
            )}
          </details>
        </>
      )}
      <button
        type="button"
        className="oneui-button oneui-button--surface oneui-button--wide mt-3"
        onClick={onCopy}
      >
        {copyLabel}
      </button>
    </div>
  ) : mode === 'onboarding' ? (
    <section className="onboarding-card">
      <div className="onboarding-card-header">
        <h2>{publicKeyLabel}</h2>
      </div>
      <p className="onboarding-card-description" role="status">
        {busy ? t('onboarding.key.preparingDescription') : t('onboarding.key.missingDescription')}
      </p>
      <div className="onboarding-card-actions">
        <button
          type="button"
          className="preferences-dialog-action"
          disabled={busy}
          onClick={onEnsure}
        >
          {t(`${key}.${busy ? 'preparing' : 'prepare'}`)}
        </button>
      </div>
    </section>
  ) : (
    <button
      type="button"
      className="oneui-button oneui-button--filled oneui-button--wide mt-6"
      disabled={busy}
      onClick={onEnsure}
    >
      {t(`${key}.${busy ? 'preparing' : 'prepare'}`)}
    </button>
  );
}
