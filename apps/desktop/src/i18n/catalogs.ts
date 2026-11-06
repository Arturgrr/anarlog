import { i18n, type I18n, type Messages } from "@lingui/core";

import { SOURCE_LOCALE, type DisplayLocale } from "./locales";
import { messages as sourceCatalog } from "./locales/en/messages";

const catalogModules = import.meta.glob<{ messages: Messages }>(
  "./locales/*/messages.ts",
);
const catalogCache = new Map<DisplayLocale, Promise<Messages>>([
  [SOURCE_LOCALE, Promise.resolve(sourceCatalog)],
]);
let createI18nGeneration = 0;

// Toasts, notifications and native labels can be translated before the
// user's catalog finishes loading; English keeps them from throwing.
if (!i18n.locale) {
  i18n.load(SOURCE_LOCALE, sourceCatalog);
  i18n.activate(SOURCE_LOCALE);
}

export function getCatalogLocalesForDisplayLocale(
  locale: DisplayLocale,
): DisplayLocale[] {
  return locale === SOURCE_LOCALE ? [SOURCE_LOCALE] : [SOURCE_LOCALE, locale];
}

export async function createI18n(locale: DisplayLocale): Promise<I18n> {
  const generation = ++createI18nGeneration;
  const locales = getCatalogLocalesForDisplayLocale(locale);
  const messages = await Promise.all(locales.map(loadCatalog));
  if (generation !== createI18nGeneration) {
    return i18n;
  }

  const sourceMessages = messages[0]!;
  const activeMessages = messages[messages.length - 1]!;

  i18n.load(SOURCE_LOCALE, sourceMessages);
  i18n.load(locale, { ...sourceMessages, ...activeMessages });
  i18n.activate(locale);

  return i18n;
}

function loadCatalog(locale: DisplayLocale): Promise<Messages> {
  const cached = catalogCache.get(locale);
  if (cached) return cached;

  const path = `./locales/${locale}/messages.ts`;
  const load = catalogModules[path];
  if (!load) {
    return Promise.reject(new Error(`Missing i18n catalog: ${locale}`));
  }

  const pending = load()
    .then((module) => module.messages)
    .catch((error: unknown) => {
      catalogCache.delete(locale);
      throw error;
    });
  catalogCache.set(locale, pending);
  return pending;
}
