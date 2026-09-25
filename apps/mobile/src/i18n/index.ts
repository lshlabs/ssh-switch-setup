import { createContext, createElement, useCallback, useContext, useEffect, useMemo } from 'react';
import en from './locales/en.json';
import ko from './locales/ko.json';
import type { CopyMode, LanguagePreference } from '@pc-control/core';

export type AppLocale = 'ko' | 'en';
export type TranslationParams = Record<string, string | number>;
export type Translate = (key: string, params?: TranslationParams) => string;

type ResourceValue = string | { [key: string]: ResourceValue };
type Resource = { [key: string]: ResourceValue };

const resources: Record<AppLocale, Resource> = { ko, en };

export function resolveLocale(
  preference: LanguagePreference,
  systemLanguage = getSystemLanguage(),
): AppLocale {
  if (preference === 'ko' || preference === 'en') return preference;
  return systemLanguage.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

function getSystemLanguage() {
  if (typeof navigator !== 'undefined' && navigator.language) return navigator.language;
  return 'en';
}

function lookup(resource: Resource, key: string): string | undefined {
  let value: ResourceValue | undefined = resource;
  for (const part of key.split('.')) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = value[part];
  }
  return typeof value === 'string' ? value : undefined;
}

function interpolate(value: string, params?: TranslationParams) {
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  );
}

function missingTranslation(locale: AppLocale) {
  return locale === 'ko' ? '표시할 수 없음' : 'Unavailable';
}

export function translate(locale: AppLocale, key: string, params?: TranslationParams): string {
  const value = lookup(resources[locale], key) ?? lookup(resources.en, key);
  return interpolate(value ?? missingTranslation(locale), params);
}

export function copyText(
  locale: AppLocale,
  copyMode: CopyMode,
  key: string,
  params?: TranslationParams,
): string {
  const value =
    lookup(resources[locale], `${key}.${copyMode}`) ??
    lookup(resources[locale], key) ??
    lookup(resources.en, `${key}.${copyMode}`) ??
    lookup(resources.en, key);
  if (value === undefined) {
    console.warn(`[i18n] Missing copy key: ${key}`);
  }
  return interpolate(value ?? missingTranslation(locale), params);
}

type I18nContextValue = {
  locale: AppLocale;
  copyMode: CopyMode;
  t: Translate;
  copy: Translate;
};

const I18nContext = createContext<I18nContextValue>({
  locale: 'ko',
  copyMode: 'simple',
  t: (key) => translate('ko', key),
  copy: (key) => copyText('ko', 'simple', key),
});

export function I18nProvider({
  languagePreference,
  copyMode,
  children,
}: {
  languagePreference: LanguagePreference;
  copyMode: CopyMode;
  children: React.ReactNode;
}) {
  const locale = resolveLocale(languagePreference);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const t = useCallback<Translate>((key, params) => translate(locale, key, params), [locale]);
  const copy = useCallback<Translate>(
    (key, params) => copyText(locale, copyMode, key, params),
    [copyMode, locale],
  );
  const value = useMemo(() => ({ locale, copyMode, t, copy }), [copy, copyMode, locale, t]);
  return createElement(I18nContext.Provider, { value }, children);
}

export function useAppCopy() {
  return useContext(I18nContext);
}
