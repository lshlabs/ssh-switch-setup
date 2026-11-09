import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { PcControl } from '@pc-control/capacitor-pc-control';
import type { OpenVpnProfile, SshIdentityResult } from '@pc-control/capacitor-pc-control';
import {
  type AppSettings,
  type LanguagePreference,
  type ThemePreference,
  REFRESH_INTERVAL_OPTIONS,
  validateSettingField,
} from '@pc-control/core';
import { DiagnosticsScreen } from './DiagnosticsScreen';
import { PageStack } from '../components/ui/page-stack';
import { usePageStack } from '../hooks/usePageStack';
import type { PcControlConfig } from '@pc-control/core';
import { PreferenceDialog } from '../components/ui/preference-dialog';
import { useAppCopy } from '../i18n';
import {
  PreferenceActionRow,
  PreferenceSection,
  PreferenceRow,
  PreferenceStatusRow,
  PreferenceToggleRow,
  PreferenceToolbar,
  PreferenceValueRow as SettingsValueRow,
} from '../components/ui/preferences';

type BackHandler = () => boolean;
type SettingsPage =
  | 'overview'
  | 'pc'
  | 'power'
  | 'remote'
  | 'display'
  | 'identity'
  | 'identity-security'
  | 'diagnostics';
type EditableField =
  | 'pcName'
  | 'pcHost'
  | 'pcUsername'
  | 'pcPort'
  | 'pcMac'
  | 'routerHost'
  | 'routerUsername'
  | 'routerPort'
  | 'wolInterface';
type SelectionModalPage = 'profile' | 'theme' | 'language' | 'copyMode' | 'refresh';
type AppSelectionPage = Exclude<SelectionModalPage, 'profile'>;
const SETTINGS_DIALOG_EXIT_MS = 300;

function settingsMotionDuration(duration: number) {
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 0
    : duration;
}

export function SettingsScreen({
  settings,
  onSave,
  onThemePreview,
  onOpenOnboarding,
  config,
  onBack,
  onToast,
  registerBack,
}: {
  settings: AppSettings;
  onSave: (next: AppSettings) => Promise<void>;
  onThemePreview: (theme: ThemePreference) => void;
  onOpenOnboarding: () => void;
  config: PcControlConfig;
  onBack: () => void;
  onToast: (message: string) => void;
  registerBack: (handler: BackHandler | null) => void;
}) {
  const { t, copy } = useAppCopy();
  const navigation = usePageStack<SettingsPage>('overview');
  const { page, open: openSettingsDetail, back: closeSettingsDetail } = navigation;
  const diagnosticsBackRef = useRef<BackHandler | null>(null);
  const registerDiagnosticsBack = useCallback((handler: BackHandler | null) => {
    diagnosticsBackRef.current = handler;
  }, []);
  const [inputEditField, setInputEditField] = useState<EditableField>();
  const [inputEditValue, setInputEditValue] = useState('');
  const [inputEditError, setInputEditError] = useState<string>();
  const [inputEditBusy, setInputEditBusy] = useState(false);
  const [inputEditClosing, setInputEditClosing] = useState(false);
  const inputEditTriggerRef = useRef<HTMLButtonElement | null>(null);
  const inputEditCloseTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [selectionModalPage, setSelectionModalPage] = useState<SelectionModalPage>();
  const [selectionModalBusy, setSelectionModalBusy] = useState(false);
  const [selectionModalClosing, setSelectionModalClosing] = useState(false);
  const selectionModalTriggerRef = useRef<HTMLButtonElement | null>(null);
  const selectionModalCloseTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [profiles, setProfiles] = useState<OpenVpnProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>();
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const resetConfirmTriggerRef = useRef<HTMLButtonElement | null>(null);
  const resetConfirmCloseRef = useRef<(() => void) | null>(null);
  const [identity, setIdentity] = useState<SshIdentityResult>();
  const [identityBusy, setIdentityBusy] = useState(false);
  const [identityFailed, setIdentityFailed] = useState(false);

  const closeInputEditor = useCallback(() => {
    if (inputEditCloseTimerRef.current) return;
    const trigger = inputEditTriggerRef.current;
    inputEditTriggerRef.current = null;
    setInputEditClosing(true);
    inputEditCloseTimerRef.current = setTimeout(() => {
      inputEditCloseTimerRef.current = undefined;
      setInputEditField(undefined);
      setInputEditValue('');
      setInputEditError(undefined);
      setInputEditClosing(false);
      if (trigger) {
        if (trigger.isConnected) trigger.focus();
      }
    }, settingsMotionDuration(SETTINGS_DIALOG_EXIT_MS));
  }, []);

  const closeSelectionModal = useCallback(() => {
    if (selectionModalCloseTimerRef.current) return;
    const trigger = selectionModalTriggerRef.current;
    selectionModalTriggerRef.current = null;
    setSelectionModalClosing(true);
    selectionModalCloseTimerRef.current = setTimeout(() => {
      selectionModalCloseTimerRef.current = undefined;
      setSelectionModalPage(undefined);
      setSelectionModalClosing(false);
      if (trigger?.isConnected) trigger.focus();
    }, settingsMotionDuration(SETTINGS_DIALOG_EXIT_MS));
  }, []);

  useEffect(() => {
    return () => {
      if (inputEditCloseTimerRef.current) clearTimeout(inputEditCloseTimerRef.current);
      if (selectionModalCloseTimerRef.current) clearTimeout(selectionModalCloseTimerRef.current);
    };
  }, []);

  useEffect(() => {
    registerBack(() => {
      if (navigation.phase !== 'idle') return true;
      if (page === 'diagnostics' && diagnosticsBackRef.current?.()) return true;
      if (showResetConfirm) {
        resetConfirmCloseRef.current?.();
        return true;
      }
      if (inputEditField) {
        if (inputEditBusy) return true;
        closeInputEditor();
        return true;
      }
      if (selectionModalPage) {
        if (selectionModalBusy) return true;
        closeSelectionModal();
        return true;
      }
      if (page === 'overview') return false;
      closeSettingsDetail();
      return true;
    });
    return () => registerBack(null);
  }, [
    navigation.phase,
    closeInputEditor,
    closeSelectionModal,
    closeSettingsDetail,
    inputEditBusy,
    inputEditField,
    page,
    registerBack,
    selectionModalBusy,
    selectionModalPage,
    showResetConfirm,
  ]);

  useEffect(() => {
    let active = true;
    void PcControl.getOpenVpnProfiles()
      .then((result) => {
        if (!active) return;
        setProfiles(result.profiles);
        setSelectedProfile(result.selectedProfileId);
      })
      .catch(() => {
        if (!active) return;
        setProfiles([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (page !== 'identity' && page !== 'identity-security') return;
    let active = true;
    void PcControl.getSshIdentity()
      .then((result) => {
        if (active) {
          setIdentity(result);
          setIdentityFailed(false);
        }
      })
      .catch(() => {
        if (active) {
          setIdentity({ available: false });
          setIdentityFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [page]);

  function openInputEditor(field: EditableField, trigger?: HTMLButtonElement) {
    inputEditTriggerRef.current = trigger ?? null;
    setInputEditField(field);
    setInputEditValue(String(settings[field]));
    setInputEditError(undefined);
  }

  function openSelectionModal(selectionPage: SelectionModalPage, trigger?: HTMLButtonElement) {
    selectionModalTriggerRef.current = trigger ?? null;
    setSelectionModalPage(selectionPage);
    setSelectionModalClosing(false);
    setSelectionModalBusy(false);
  }

  async function confirmInputEditor() {
    if (!inputEditField || inputEditBusy || inputEditClosing) return;
    const field = inputEditField;
    const numeric = field === 'pcPort' || field === 'routerPort';
    const value = numeric ? Number(inputEditValue) : inputEditValue;
    const next = { ...settings, [field]: value } as AppSettings;
    const validationError = validateSettingField(next, field)[0];
    if (validationError) {
      setInputEditError(t(validationError.key));
      return;
    }

    setInputEditBusy(true);
    try {
      await onSave(next);
      closeInputEditor();
    } catch {
      onToast(t('settings.toast.saved'));
    } finally {
      setInputEditBusy(false);
    }
  }

  async function save(next: AppSettings, toastMessage?: string): Promise<boolean> {
    try {
      await onSave(next);
      if (toastMessage) onToast(toastMessage);
      return true;
    } catch {
      onToast(t('settings.toast.saved'));
      return false;
    }
  }

  async function selectProfile(id: string) {
    if (selectionModalBusy) return;
    setSelectionModalBusy(true);
    try {
      const result = await PcControl.selectOpenVpnProfile({ profileId: id });
      setProfiles(result.profiles);
      setSelectedProfile(result.selectedProfileId);
      closeSelectionModal();
      onToast(t('settings.toast.profileSelected'));
    } catch {
      onToast(t('settings.toast.profileSelectFailed'));
    } finally {
      setSelectionModalBusy(false);
    }
  }

  async function refreshProfiles() {
    if (selectionModalBusy) return;
    setSelectionModalBusy(true);
    try {
      const result = await PcControl.getOpenVpnProfiles();
      setProfiles(result.profiles);
      setSelectedProfile(result.selectedProfileId);
      onToast(t('settings.toast.profilesRefreshed'));
    } catch {
      onToast(t('settings.toast.profilesLoadFailed'));
    } finally {
      setSelectionModalBusy(false);
    }
  }

  async function openOpenVpnApp() {
    if (selectionModalBusy) return;
    setSelectionModalBusy(true);
    try {
      await PcControl.openOpenVpnApp();
    } catch {
      onToast(t('settings.toast.openVpnAppOpenFailed'));
    } finally {
      setSelectionModalBusy(false);
    }
  }

  async function selectAppSetting(value: string) {
    if (!selectionModalPage || selectionModalPage === 'profile' || selectionModalBusy) return;
    const selectionPage = selectionModalPage;
    const selection = selectionOptions(selectionPage, t);
    const next = {
      ...settings,
      ...(selectionPage === 'theme' ? { themePreference: value as ThemePreference } : {}),
      ...(selectionPage === 'language' ? { languagePreference: value as LanguagePreference } : {}),
      ...(selectionPage === 'copyMode' ? { copyMode: value as AppSettings['copyMode'] } : {}),
      ...(selectionPage === 'refresh' ? { refreshIntervalSec: Number(value) } : {}),
    };
    if (selectionPage === 'theme') onThemePreview(value as ThemePreference);
    setSelectionModalBusy(true);
    const saved = await save(
      next,
      selectionPage === 'theme'
        ? t('settings.toast.themeApplied', {
            value: selection.options.find((item) => item.value === value)?.label ?? value,
          })
        : undefined,
    );
    setSelectionModalBusy(false);
    if (saved) closeSelectionModal();
    else if (selectionPage === 'theme') onThemePreview(settings.themePreference);
  }

  async function resetSettings() {
    const defaults = {
      ...settings,
      pcName: '내 PC',
      pcHost: '',
      pcUsername: '',
      pcMac: '',
      routerHost: '',
      routerUsername: '',
      wolInterface: '',
      onboardingStep: 0,
      onboardingCompleted: false,
    } satisfies AppSettings;
    if (await save(defaults, t('settings.toast.reset'))) onOpenOnboarding();
  }

  async function ensureIdentity() {
    setIdentityBusy(true);
    setIdentityFailed(false);
    try {
      setIdentity(await PcControl.ensureSshIdentity());
      onToast(t('settings.identity.ready'));
    } catch {
      setIdentityFailed(true);
      onToast(t('settings.identity.prepareFailed'));
    } finally {
      setIdentityBusy(false);
    }
  }

  async function copyIdentity() {
    let toastMessage: string;
    let copied = false;
    try {
      await PcControl.copySshPublicKey();
      toastMessage = t('settings.identity.copied');
      copied = true;
    } catch {
      toastMessage = t('settings.identity.copyFailed');
    }
    await showIdentitySystemToast(toastMessage, copied);
  }

  async function copyIdentityFingerprint() {
    let toastMessage: string;
    let copied = false;
    try {
      await PcControl.copySshFingerprint();
      toastMessage = t('settings.identity.fingerprintCopied');
      copied = true;
    } catch {
      toastMessage = t('settings.identity.fingerprintCopyFailed');
    }
    await showIdentitySystemToast(toastMessage, copied);
  }

  async function showIdentitySystemToast(message: string, copied: boolean) {
    try {
      await PcControl.showSystemToast({
        message,
        skipWhenClipboardConfirmationAvailable: copied,
      });
    } catch {
      // Clipboard feedback is intentionally limited to the Android system toast.
    }
  }

  function renderPage(page: SettingsPage) {
    if (page === 'diagnostics')
      return (
        <DiagnosticsScreen
          settings={settings}
          config={config}
          onToast={onToast}
          onBack={closeSettingsDetail}
          registerBack={registerDiagnosticsBack}
        />
      );
    if (page === 'identity') {
      return (
        <SshIdentitySettingsPage
          identity={identity}
          busy={identityBusy}
          failed={identityFailed}
          onEnsure={() => void ensureIdentity()}
          onOpenSecurity={() => openSettingsDetail('identity-security')}
          onBack={closeSettingsDetail}
          t={t}
          copy={copy}
        />
      );
    }
    if (page === 'identity-security') {
      return (
        <SshIdentitySecurityPage
          identity={identity}
          onCopyFingerprint={() => void copyIdentityFingerprint()}
          onCopyPublicKey={() => void copyIdentity()}
          onBack={closeSettingsDetail}
          t={t}
          copy={copy}
        />
      );
    }

    if (page !== 'overview') {
      return (
        <>
          <SettingsDetailPage
            page={page}
            settings={settings}
            selectedProfile={selectedProfile}
            profiles={profiles}
            onOpenInputEditor={openInputEditor}
            onOpenProfile={(event) => openSelectionModal('profile', event?.currentTarget)}
            onOpenVpnApp={() => {
              void openOpenVpnApp();
            }}
            onToggleAutoDisconnect={(checked) =>
              void save({ ...settings, autoDisconnectVpn: checked })
            }
            onOpenSelection={(selectionPage, trigger) => openSelectionModal(selectionPage, trigger)}

            onBack={closeSettingsDetail}
            t={t}
            copy={copy}
          />
          {(page === 'pc' || page === 'power') && inputEditField && (
            <SettingsInputDialog
              field={inputEditField}
              value={inputEditValue}
              error={inputEditError}
              busy={inputEditBusy}
              closing={inputEditClosing}
              onChange={(value) => {
                setInputEditValue(value);
                setInputEditError(undefined);
              }}
              onCancel={closeInputEditor}
              onConfirm={() => void confirmInputEditor()}
              t={t}
              copy={copy}
            />
          )}
          {(page === 'remote' || page === 'display') && selectionModalPage && (
            <SettingsSelectionDialog
              title={selectionDialogTitle(selectionModalPage, t)}
              selectedValue={selectionDialogValue(selectionModalPage, settings, selectedProfile)}
              options={selectionDialogOptions(selectionModalPage, profiles, t)}
              emptyMessage={t('settings.remote.profileEmpty')}
              busy={selectionModalBusy}
              closing={selectionModalClosing}
              onSelect={(value) => {
                if (selectionModalPage === 'profile') void selectProfile(value);
                else void selectAppSetting(value);
              }}
              {...(selectionModalPage === 'profile'
                ? {
                    onRefresh: () => void refreshProfiles(),
                    ...(profiles.length === 0
                      ? {
                          onOpenVpnApp: () => {
                            void openOpenVpnApp();
                          },
                        }
                      : {}),
                  }
                : {})}
              onCancel={closeSelectionModal}
              t={t}
            />
          )}
        </>
      );
    }

    return (
      <div className="settings-page settings-overview-page preferences-page">
        <PreferenceToolbar
          title={t('settings.title')}
          backLabel={t('navigation.backToHome')}
          onBack={onBack}
        />
        <section className="preferences-list" aria-label={t('navigation.settingsItems')}>
          <div className="preferences-group">
            <PreferenceRow
              detailPage="pc"
              icon="multi-devices"
              title={t('settings.pages.pc')}
              summary={t('settings.overview.pcDescription')}
              onClick={() => openSettingsDetail('pc')}
            />
            <PreferenceRow
              detailPage="power"
              icon="connections"
              title={t('settings.pages.power')}
              summary={t('settings.overview.powerDescription')}
              onClick={() => openSettingsDetail('power')}
            />
            <PreferenceRow
              detailPage="remote"
              icon="security"
              title={t('settings.pages.remote')}
              summary={t('settings.overview.remoteDescription')}
              onClick={() => openSettingsDetail('remote')}
            />
            <PreferenceRow
              detailPage="display"
              icon="display"
              title={t('settings.pages.display')}
              summary={t('settings.overview.displayDescription')}
              onClick={() => openSettingsDetail('display')}
            />
          </div>
          <div className="preferences-group">
            <PreferenceRow
              detailPage="identity"
              icon="security"
              title={t('settings.pages.identity')}
              summary={t('settings.identity.overviewDescription')}
              onClick={() => openSettingsDetail('identity')}
            />
            <PreferenceRow
              detailPage="diagnostics"
              icon="modes"
              title={t('common.diagnostics')}
              summary={t('settings.overview.diagnosticsDescription')}
              onClick={() => openSettingsDetail('diagnostics')}
            />
          </div>
          <div className="preferences-group">
            <PreferenceRow
              icon="tips"
              title={t('settings.overview.setupWizard')}
              onClick={onOpenOnboarding}
              className="settings-overview-action-row"
            />
            <PreferenceRow
              buttonRef={resetConfirmTriggerRef}
              icon="modes"
              title={t('settings.overview.resetConnection')}
              onClick={() => setShowResetConfirm(true)}
              className="settings-overview-action-row settings-overview-reset-row"
            />
          </div>
        </section>
        {showResetConfirm && (
          <PreferenceDialog
            variant="confirm"
            title={t('settings.reset.title')}
            closeRef={resetConfirmCloseRef}
            returnFocusRef={resetConfirmTriggerRef}
            onClose={() => setShowResetConfirm(false)}
            actions={[
              { label: t('common.cancel'), close: true },
              { label: t('common.reset'), close: true, onClick: () => void resetSettings() },
            ]}
          >
            <p>{t('settings.reset.message')}</p>
          </PreferenceDialog>
        )}
      </div>
    );
  }
  return <PageStack navigation={navigation}>{renderPage}</PageStack>;
}

function SettingsDetailPage({
  page,
  settings,
  selectedProfile,
  profiles,
  onOpenInputEditor,
  onOpenProfile,
  onOpenVpnApp,
  onToggleAutoDisconnect,
  onOpenSelection,
  onBack,
  t,
  copy,
}: {
  page: 'pc' | 'power' | 'remote' | 'display';
  settings: AppSettings;
  selectedProfile: string | undefined;
  profiles: OpenVpnProfile[];
  onOpenInputEditor: (field: EditableField, trigger?: HTMLButtonElement) => void;
  onOpenProfile: (event?: React.MouseEvent<HTMLButtonElement>) => void;
  onOpenVpnApp: () => void;
  onToggleAutoDisconnect: (checked: boolean) => void;
  onOpenSelection: (
    page: Exclude<SelectionModalPage, 'profile'>,
    trigger?: HTMLButtonElement,
  ) => void;
  onBack: () => void;
  t: (key: string, params?: { value: string | number }) => string;
  copy: (key: string, params?: { value: string | number }) => string;
}) {
  const title = t(`settings.pages.${page}`);
  return (
    <div className="settings-page settings-detail-page preferences-page">
      <SettingsDetailTop title={title} onBack={onBack} backLabel={t('navigation.backToSettings')} />
      {page === 'pc' && (
        <>
          <SettingsDetailBlock title={t('settings.pc.section')}>
            <SettingsValueRow
              label={t('settings.pc.name')}
              value={settings.pcName || t('common.notSelected')}
              onClick={(event) => onOpenInputEditor('pcName', event.currentTarget)}
            />
            <SettingsValueRow
              label={t('settings.pc.host')}
              value={settings.pcHost || t('settings.overview.infoNeeded')}
              onClick={(event) => onOpenInputEditor('pcHost', event.currentTarget)}
            />
            <SettingsValueRow
              label={copy('settings.pc.username')}
              value={settings.pcUsername || t('settings.overview.infoNeeded')}
              onClick={(event) => onOpenInputEditor('pcUsername', event.currentTarget)}
            />
          </SettingsDetailBlock>
          <SettingsDetailBlock title={t('settings.pc.advanced')}>
            <SettingsValueRow
              label={t('settings.pc.port')}
              value={String(settings.pcPort)}
              onClick={(event) => onOpenInputEditor('pcPort', event.currentTarget)}
            />
          </SettingsDetailBlock>
        </>
      )}
      {page === 'power' && (
        <>
          <SettingsDetailBlock title={t('settings.power.section')}>
            <SettingsValueRow
              label={copy('settings.power.mac')}
              value={settings.pcMac || t('settings.overview.infoNeeded')}
              onClick={(event) => onOpenInputEditor('pcMac', event.currentTarget)}
              mono
            />
            <SettingsValueRow
              label={t('settings.power.routerHost')}
              value={settings.routerHost || t('settings.overview.infoNeeded')}
              onClick={(event) => onOpenInputEditor('routerHost', event.currentTarget)}
            />
            <SettingsValueRow
              label={copy('settings.power.routerUsername')}
              value={settings.routerUsername || t('settings.overview.infoNeeded')}
              onClick={(event) => onOpenInputEditor('routerUsername', event.currentTarget)}
            />
          </SettingsDetailBlock>
          <SettingsDetailBlock title={t('settings.power.advanced')}>
            <SettingsValueRow
              label={t('settings.power.routerPort')}
              value={String(settings.routerPort)}
              onClick={(event) => onOpenInputEditor('routerPort', event.currentTarget)}
            />
            <SettingsValueRow
              label={copy('settings.power.interface')}
              value={settings.wolInterface || t('settings.overview.infoNeeded')}
              onClick={(event) => onOpenInputEditor('wolInterface', event.currentTarget)}
              mono
            />
          </SettingsDetailBlock>
        </>
      )}
      {page === 'remote' && (
        <SettingsDetailBlock title={t('settings.remote.section')}>
          <SettingsValueRow
            label={t('settings.remote.openApp')}
            value={t('settings.remote.app')}
            onClick={onOpenVpnApp}
          />
          <SettingsValueRow
            label={t('settings.remote.profile')}
            value={
              profiles.find((profile) => profile.id === selectedProfile)?.name ??
              t('common.notSelected')
            }
            onClick={onOpenProfile}
          />
          <PreferenceToggleRow
            label={t('settings.remote.autoDisconnect')}
            description={t('settings.remote.autoDisconnectDescription')}
            checked={settings.autoDisconnectVpn}
            onCheckedChange={onToggleAutoDisconnect}
          />
        </SettingsDetailBlock>
      )}
      {page === 'display' && (
        <SettingsDetailBlock>
          <SettingsValueRow
            label={t('settings.display.theme')}
            value={themeLabel(settings.themePreference, t)}
            onClick={(event) => onOpenSelection('theme', event.currentTarget)}
          />
          <SettingsValueRow
            label={t('settings.display.language')}
            value={languageLabel(settings.languagePreference, t)}
            onClick={(event) => onOpenSelection('language', event.currentTarget)}
          />
          <SettingsValueRow
            label={t('settings.display.copyMode')}
            value={t(`common.${settings.copyMode}`)}
            onClick={(event) => onOpenSelection('copyMode', event.currentTarget)}
          />
          <SettingsValueRow
            label={t('settings.display.refresh')}
            value={refreshIntervalLabel(settings.refreshIntervalSec, t)}
            onClick={(event) => onOpenSelection('refresh', event.currentTarget)}
          />
        </SettingsDetailBlock>
      )}
    </div>
  );
}

function SshIdentitySettingsPage({
  identity,
  busy,
  failed,
  onEnsure,
  onOpenSecurity,
  onBack,
  t,
  copy,
}: {
  identity: SshIdentityResult | undefined;
  busy: boolean;
  failed: boolean;
  onEnsure: () => void;
  onOpenSecurity: () => void;
  onBack: () => void;
  t: (key: string) => string;
  copy: (key: string) => string;
}) {
  const [showDescription, setShowDescription] = useState(false);
  const descriptionTriggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="settings-page settings-detail-page preferences-page">
      <SettingsDetailTop
        title={copy('settings.identity.pageTitle')}
        onBack={onBack}
        backLabel={t('navigation.backToSettings')}
        helpLabel={t('settings.identity.showDescription')}
        helpButtonRef={descriptionTriggerRef}
        onHelp={() => setShowDescription(true)}
      />
      <PreferenceSection className="settings-detail-block">
        <PreferenceStatusRow
          label={copy('settings.identity.keyTitle')}
          description={
            failed
              ? copy('settings.identity.failedSummary')
              : busy
                ? copy('settings.identity.preparingSummary')
                : identity?.available
                  ? copy('settings.identity.readySummary')
                  : copy('settings.identity.missingSummary')
          }
          descriptionTone={failed ? 'danger' : identity?.available ? 'success' : 'warning'}
        />
        {identity?.available ? (
          <PreferenceActionRow
            label={copy('settings.identity.securityTitle')}
            description={copy('settings.identity.securityDescription')}
            onClick={onOpenSecurity}
          />
        ) : (
          <PreferenceActionRow
            label={copy('settings.identity.prepareTitle')}
            description={copy('settings.identity.prepareDescription')}
            disabled={busy}
            onClick={onEnsure}
          />
        )}
      </PreferenceSection>
      {showDescription && (
        <PreferenceDialog
          title={copy('settings.identity.pageTitle')}
          returnFocusRef={descriptionTriggerRef}
          onClose={() => setShowDescription(false)}
          actions={[{ label: t('common.close'), close: true }]}
        >
          <p>{copy('settings.identity.description')}</p>
        </PreferenceDialog>
      )}
    </div>
  );
}

function SshIdentitySecurityPage({
  identity,
  onCopyFingerprint,
  onCopyPublicKey,
  onBack,
  t,
  copy,
}: {
  identity: SshIdentityResult | undefined;
  onCopyFingerprint: () => void;
  onCopyPublicKey: () => void;
  onBack: () => void;
  t: (key: string) => string;
  copy: (key: string) => string;
}) {
  const [showDescription, setShowDescription] = useState(false);
  const descriptionTriggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="settings-page settings-detail-page preferences-page">
      <SettingsDetailTop
        title={copy('settings.identity.securityTitle')}
        onBack={onBack}
        backLabel={t('navigation.back')}
        helpLabel={t('settings.identity.showDescription')}
        helpButtonRef={descriptionTriggerRef}
        onHelp={() => setShowDescription(true)}
      />
      <PreferenceSection className="settings-detail-block">
        <PreferenceActionRow
          label={copy('settings.identity.fingerprintTitle')}
          description={identity?.fingerprint ?? copy('settings.identity.missingSummary')}
          descriptionTone="accent"
          disabled={!identity?.available}
          onClick={onCopyFingerprint}
          mono
        />
        <PreferenceActionRow
          label={copy('settings.identity.publicKeyTitle')}
          description={identity?.publicKey ?? copy('settings.identity.missingSummary')}
          descriptionTone="accent"
          disabled={!identity?.available}
          onClick={onCopyPublicKey}
          mono
        />
      </PreferenceSection>
      {showDescription && (
        <PreferenceDialog
          title={copy('settings.identity.securityTitle')}
          returnFocusRef={descriptionTriggerRef}
          onClose={() => setShowDescription(false)}
          actions={[{ label: t('common.close'), close: true }]}
        >
          <p>{copy('settings.identity.securityPageDescription')}</p>
        </PreferenceDialog>
      )}
    </div>
  );
}

function SettingsInputDialog({
  field,
  value,
  error,
  busy,
  closing,
  onChange,
  onCancel,
  onConfirm,
  t,
  copy,
}: {
  field: EditableField;
  value: string;
  error: string | undefined;
  busy: boolean;
  closing: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  t: (key: string) => string;
  copy: (key: string) => string;
}) {
  const label = fieldLabel(field, t, copy);
  const numeric = field === 'pcPort' || field === 'routerPort';
  const dialogRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!busy && !closing) onCancel();
        return;
      }
      if (closing) return;
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)'),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [busy, closing, onCancel]);

  return (
    <div
      className={`preferences-dialog-backdrop ${closing ? 'is-closing' : ''}`}
      role="presentation"
      onClick={(event) => {
        if (!busy && !closing && event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        className={`preferences-dialog preferences-dialog-edit ${closing ? 'is-closing' : ''}`}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-input-dialog-title"
        aria-busy={busy}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <div className="preferences-dialog-title-area">
          <h2 id="settings-input-dialog-title">{label}</h2>
        </div>
        <div className="preferences-dialog-content preferences-dialog-edit-content">
          <div className="preferences-dialog-edit-scroll">
            <label className="preferences-dialog-edit-container">
              <input
                autoFocus
                className={`preferences-dialog-input ${field === 'pcMac' || field === 'wolInterface' ? 'font-mono' : ''}`}
                type={numeric ? 'number' : 'text'}
                inputMode={numeric ? 'numeric' : undefined}
                value={value}
                placeholder={fieldPlaceholder(field, t)}
                autoCapitalize={field === 'pcMac' ? 'characters' : 'none'}
                spellCheck={false}
                aria-label={label}
                aria-invalid={error ? true : undefined}
                aria-describedby="settings-input-dialog-error"
                onChange={(event) =>
                  onChange(
                    field === 'pcMac' ? event.target.value.toUpperCase() : event.target.value,
                  )
                }
              />
            </label>
            <p
              id="settings-input-dialog-error"
              className={`settings-input-dialog-error ${error ? '' : 'is-empty'}`}
              aria-live="polite"
            >
              {error}
            </p>
          </div>
        </div>
        <div className="preferences-dialog-actions">
          <button
            type="button"
            className="preferences-dialog-action"
            onClick={onCancel}
            disabled={busy || closing}
          >
            <span>{t('common.cancel')}</span>
          </button>
          <span className="preferences-dialog-action-divider" aria-hidden="true" />
          <button type="submit" className="preferences-dialog-action" disabled={busy || closing}>
            <span>{t('common.confirm')}</span>
          </button>
        </div>
      </form>
    </div>
  );
}

function SettingsSelectionDialog({
  title,
  selectedValue,
  options,
  emptyMessage,
  busy,
  closing,
  onSelect,
  onRefresh,
  onOpenVpnApp,
  onCancel,
  t,
}: {
  title: string;
  selectedValue: string | undefined;
  options: Array<{ value: string; label: string }>;
  emptyMessage: string;
  busy: boolean;
  closing: boolean;
  onSelect: (value: string) => void;
  onRefresh?: () => void;
  onOpenVpnApp?: () => void;
  onCancel: () => void;
  t: (key: string) => string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const showOpenVpnApp = Boolean(onOpenVpnApp && options.length === 0);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!busy && !closing) onCancel();
        return;
      }
      if (closing || event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)'),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [busy, closing, onCancel]);

  useEffect(() => {
    if (closing) return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'input:not(:disabled), button:not(:disabled)',
      ) ?? [],
    );
    const selected = dialogRef.current?.querySelector<HTMLInputElement>(
      'input[type="radio"]:checked',
    );
    (selected ?? focusable[0])?.focus();
  }, [closing]);

  return (
    <div
      className={`preferences-dialog-backdrop ${closing ? 'is-closing' : ''}`}
      role="presentation"
      onClick={(event) => {
        if (!busy && !closing && event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className={`preferences-dialog preferences-dialog-choice ${closing ? 'is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-selection-dialog-title"
        aria-busy={busy}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="preferences-dialog-title-area">
          <h2 id="settings-selection-dialog-title">{title}</h2>
        </div>
        <div className="preferences-dialog-content preferences-dialog-choice-content">
          <div
            className="preferences-dialog-options"
            role={options.length ? 'radiogroup' : undefined}
            aria-label={options.length ? title : undefined}
          >
            {options.length ? (
              options.map((option) => (
                <label
                  key={option.value}
                  className={`preferences-dialog-choice-row ${option.value === selectedValue ? 'is-selected' : ''}`}
                >
                  <input
                    className="settings-native-radio"
                    type="radio"
                    name="settings-selection"
                    checked={option.value === selectedValue}
                    disabled={busy || closing}
                    onChange={() => onSelect(option.value)}
                  />
                  <span className="preferences-dialog-choice-indicator" aria-hidden="true" />
                  <span>{option.label}</span>
                </label>
              ))
            ) : (
              <p className="settings-empty-message">{emptyMessage}</p>
            )}
          </div>
        </div>
        {showOpenVpnApp && (
          <button
            type="button"
            className="settings-selection-dialog-open-app"
            onClick={() => onOpenVpnApp?.()}
            disabled={busy || closing}
          >
            <span>{t('settings.remote.openApp')}</span>
          </button>
        )}
        <div className="preferences-dialog-actions">
          {onRefresh && (
            <>
              <button
                type="button"
                className="preferences-dialog-action"
                onClick={onRefresh}
                disabled={busy || closing}
              >
                <span>{t('settings.remote.refresh')}</span>
              </button>
              <span className="preferences-dialog-action-divider" aria-hidden="true" />
            </>
          )}
          <button
            type="button"
            className="preferences-dialog-action"
            onClick={onCancel}
            disabled={busy || closing}
          >
            <span>{t('common.cancel')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsDetailTop({
  title,
  onBack,
  backLabel,
  helpLabel,
  helpButtonRef,
  onHelp,
}: {
  title: string;
  onBack: () => void;
  backLabel: string;
  helpLabel?: string;
  helpButtonRef?: React.RefObject<HTMLButtonElement | null>;
  onHelp?: () => void;
}) {
  return (
    <PreferenceToolbar
      title={title}
      backLabel={backLabel}
      onBack={onBack}
      action={
        onHelp && helpLabel ? (
          <button
            ref={helpButtonRef}
            type="button"
            className="preferences-toolbar-help"
            aria-label={helpLabel}
            onClick={onHelp}
          >
            <CircleHelp size={24} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : undefined
      }
    />
  );
}

function SettingsDetailBlock({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <PreferenceSection className="settings-detail-block" title={title}>
      {children}
    </PreferenceSection>
  );
}

function themeLabel(theme: ThemePreference, t: (key: string) => string) {
  return t(`common.${theme}`);
}
function languageLabel(language: LanguagePreference, t: (key: string) => string) {
  return language === 'system'
    ? t('common.languageSystem')
    : language === 'ko'
      ? t('common.korean')
      : t('common.english');
}
function refreshIntervalLabel(
  value: number,
  t: (key: string, params?: { value: number }) => string,
) {
  return value === 0
    ? t('settings.display.refreshOff')
    : t('settings.display.refreshSeconds', { value });
}

function selectionDialogTitle(
  page: SelectionModalPage,
  t: (key: string, params?: { value: string | number }) => string,
) {
  return page === 'profile' ? t('settings.remote.profile') : selectionOptions(page, t).title;
}

function selectionDialogValue(
  page: SelectionModalPage,
  settings: AppSettings,
  selectedProfile: string | undefined,
) {
  if (page === 'profile') return selectedProfile;
  if (page === 'theme') return settings.themePreference;
  if (page === 'language') return settings.languagePreference;
  if (page === 'copyMode') return settings.copyMode;
  return String(settings.refreshIntervalSec);
}

function selectionDialogOptions(
  page: SelectionModalPage,
  profiles: OpenVpnProfile[],
  t: (key: string, params?: { value: string | number }) => string,
) {
  return page === 'profile'
    ? profiles.map((profile) => ({ value: profile.id, label: profile.name }))
    : selectionOptions(page, t).options;
}

function selectionOptions(
  page: AppSelectionPage,
  t: (key: string, params?: { value: string | number }) => string,
) {
  if (page === 'theme')
    return {
      title: t('settings.display.theme'),
      options: [
        { value: 'system', label: t('common.system') },
        { value: 'light', label: t('common.light') },
        { value: 'dark', label: t('common.dark') },
      ],
    };
  if (page === 'language')
    return {
      title: t('settings.display.language'),
      options: [
        { value: 'system', label: t('common.languageSystem') },
        { value: 'ko', label: t('common.korean') },
        { value: 'en', label: t('common.english') },
      ],
    };
  if (page === 'copyMode')
    return {
      title: t('settings.display.copyMode'),
      options: [
        { value: 'simple', label: t('common.simple') },
        { value: 'technical', label: t('common.technical') },
      ],
    };
  return {
    title: t('settings.display.refresh'),
    options: REFRESH_INTERVAL_OPTIONS.map((value) => ({
      value: String(value),
      label: refreshIntervalLabel(value, t),
    })),
  };
}

function fieldLabel(
  field: EditableField,
  t: (key: string) => string,
  copy: (key: string) => string,
) {
  if (field === 'pcName') return t('settings.pc.name');
  if (field === 'pcHost') return t('settings.pc.host');
  if (field === 'pcUsername') return copy('settings.pc.username');
  if (field === 'pcPort') return t('settings.pc.port');
  if (field === 'pcMac') return copy('settings.power.mac');
  if (field === 'routerHost') return t('settings.power.routerHost');
  if (field === 'routerUsername') return copy('settings.power.routerUsername');
  if (field === 'routerPort') return t('settings.power.routerPort');
  return copy('settings.power.interface');
}

function fieldPlaceholder(field: EditableField, t: (key: string) => string) {
  if (field === 'pcHost') return t('settings.pc.hostPlaceholder');
  if (field === 'pcUsername') return t('settings.pc.usernamePlaceholder');
  if (field === 'pcMac') return t('settings.power.macPlaceholder');
  if (field === 'routerUsername') return t('settings.power.routerUsernamePlaceholder');
  if (field === 'wolInterface') return t('settings.power.interfacePlaceholder');
  return undefined;
}
