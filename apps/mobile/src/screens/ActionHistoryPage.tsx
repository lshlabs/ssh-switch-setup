import { useEffect } from 'react';
import { Check, History } from 'lucide-react';
import type { PowerActionHistoryItem } from '../hooks/useHomeSession';
import {
  ACTION_ICON,
  ACTION_LABEL_KEY,
  actionHistoryDescriptionKey,
  actionHistoryOutcomeKey,
  actionHistoryTone,
} from '../lib/actionHistory';
import { useAppCopy } from '../i18n';
import type { Translate } from '../i18n';
import { PreferenceToolbar } from '../components/ui/preferences';

type BackHandler = () => boolean;

export function ActionHistoryPage({
  history,
  onBack,
  registerBack,
}: {
  history: PowerActionHistoryItem[];
  onBack: () => void;
  registerBack: (handler: BackHandler | null) => void;
}) {
  const { t, locale } = useAppCopy();

  useEffect(() => {
    registerBack(() => {
      onBack();
      return true;
    });
    return () => registerBack(null);
  }, [onBack, registerBack]);

  return (
    <div className="preferences-page action-history-page">
      <PreferenceToolbar
        title={t('history.title')}
        backLabel={t('navigation.backToHome')}
        onBack={onBack}
      />
      <div className="action-history-content">
        {history.length ? (
          <ActionHistoryList history={history} t={t} locale={locale} />
        ) : (
          <div className="action-history-empty-layout">
            <section className="action-history-empty" aria-live="polite">
              <History size={28} aria-hidden="true" />
              <h2>{t('history.emptyTitle')}</h2>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function ActionHistoryList({
  history,
  t,
  locale,
}: {
  history: PowerActionHistoryItem[];
  t: Translate;
  locale: string;
}) {
  return (
    <ol className="action-history-page-list">
      {history.map((item) => {
        const Icon = ACTION_ICON[item.action];
        const tone = actionHistoryTone(item.action, item.finalStatus);
        const outcomeKey = actionHistoryOutcomeKey(item.finalStatus);
        const outcomeTone =
          item.finalStatus === 'error'
            ? 'error'
            : item.finalStatus === 'online' || item.finalStatus === 'offline'
              ? 'complete'
              : 'pending';

        return (
          <li className="action-history-page-item" key={item.id}>
            <span
              className={`action-history-page-icon action-history-page-icon--${tone}`}
              aria-hidden="true"
            >
              <Icon size={19} />
            </span>
            <div className="action-history-page-copy">
              <div className="action-history-page-heading">
                <strong>{t(ACTION_LABEL_KEY[item.action])}</strong>
                <time dateTime={new Date(item.completedAt).toISOString()}>
                  {formatCompletedAt(item.completedAt, locale)}
                </time>
              </div>
              <p>{t(actionHistoryDescriptionKey(item.action, item.finalStatus))}</p>
              <div className="action-history-page-meta">
                <span
                  className={`action-history-page-outcome action-history-page-outcome--${outcomeTone}`}
                >
                  {outcomeTone === 'complete' && <Check size={12} aria-hidden="true" />}
                  {t(outcomeKey)}
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function formatCompletedAt(timestamp: number, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp);
}
