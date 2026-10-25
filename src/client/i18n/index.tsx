import { createContext, Fragment, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isLang, makeTranslator, N_, pickLanguage, type Lang, type Params, type Translator } from '../../shared/i18n/core';
import { sharedNl } from '../../shared/i18n/nl';
import { clientNl } from './nl';

export { N_ };
export type { Lang };

const catalogs = { en: {}, nl: { ...sharedNl, ...clientNl } } as const;

let translator: Translator = makeTranslator('en', catalogs.en);

/** The language the interface is shown in right now. */
export function currentLang(): Lang {
  return translator.lang;
}

/** Locale for numbers, times and sorting in the current language. */
export function currentLocale(): string {
  return translator.locale;
}

/** The translator itself, for shared helpers that take one. */
export function tr(): Translator {
  return translator;
}

/** Translates interface text. The English text is the key; see src/shared/i18n/core.ts. */
export function t(text: string, params?: Params): string {
  return translator.t(text, params);
}

/** Counted text: `tn('{count} task', '{count} tasks', n)`. */
export function tn(one: string, other: string, count: number, params?: Params): string {
  return translator.tn(one, other, count, params);
}

/**
 * Like t(), but placeholders can be elements:
 * `tx('Signed in as {name}', { name: <strong>{email}</strong> })`.
 */
export function tx(text: string, params: Record<string, ReactNode>): ReactNode {
  const template = translator.t(text);
  const pieces = template.split(/(\{\w+\})/g);
  return pieces.map((piece, i) => {
    const match = /^\{(\w+)\}$/.exec(piece);
    if (match && match[1]! in params) {
      const value = params[match[1]!];
      return <Fragment key={i}>{typeof value === 'number' ? value.toLocaleString(translator.locale) : value}</Fragment>;
    }
    return piece ? <Fragment key={i}>{piece}</Fragment> : null;
  });
}

// ---------------------------------------------------------------------------
// Choosing the language
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'ph-lang';
const DEFAULT_KEY = 'ph-lang-default';

function readStorage(key: string): Lang | null {
  try {
    const value = localStorage.getItem(key);
    return isLang(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: Lang | null): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for this visit.
  }
}

/** The language picked in this browser, if any. */
export function chosenLanguage(): Lang | null {
  return readStorage(STORAGE_KEY);
}

/**
 * Which language to start in: the person's own choice, then the workspace
 * default an admin set (DEFAULT_LANGUAGE), then the browser's language.
 */
export function startingLanguage(): Lang {
  return chosenLanguage() ?? readStorage(DEFAULT_KEY) ?? pickLanguage(navigator.languages ?? [navigator.language]) ?? 'en';
}

function apply(lang: Lang): void {
  translator = makeTranslator(lang, catalogs[lang]);
  document.documentElement.lang = lang;
}

// Set before the first render, so the first screen is already in the right language.
apply(startingLanguage());

interface LanguageApi {
  lang: Lang;
  /** Switches the interface. `remember` keeps the choice in this browser (false for automatic changes). */
  setLang: (lang: Lang, options?: { remember?: boolean }) => void;
  /** Applies the workspace default from the server, unless the person chose a language themselves. */
  setWorkspaceDefault: (lang: Lang | null) => void;
  /** Forgets the choice made in this browser and goes back to the automatic language. */
  followAutomatic: () => void;
}

const LanguageContext = createContext<LanguageApi | null>(null);

/**
 * Holds the interface language. Changing it re-mounts everything below, so all
 * text is drawn again in the new language (it changes rarely, so that's fine).
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(currentLang);
  const queryClient = useQueryClient();

  const switchTo = useCallback(
    (next: Lang) => {
      apply(next);
      setLangState(next);
      // Some text comes from the server (messages, project health), so fetch it again.
      void queryClient.invalidateQueries();
    },
    [queryClient],
  );

  const setLang = useCallback<LanguageApi['setLang']>(
    (next, options) => {
      if (options?.remember !== false) writeStorage(STORAGE_KEY, next);
      if (next !== currentLang()) switchTo(next);
    },
    [switchTo],
  );

  const setWorkspaceDefault = useCallback<LanguageApi['setWorkspaceDefault']>(
    (value) => {
      writeStorage(DEFAULT_KEY, value);
      if (value && !chosenLanguage() && value !== currentLang()) switchTo(value);
    },
    [switchTo],
  );

  const followAutomatic = useCallback(() => {
    writeStorage(STORAGE_KEY, null);
    const next = startingLanguage();
    if (next !== currentLang()) switchTo(next);
  }, [switchTo]);

  const api = useMemo(() => ({ lang, setLang, setWorkspaceDefault, followAutomatic }), [lang, setLang, setWorkspaceDefault, followAutomatic]);
  return (
    <LanguageContext.Provider value={api}>
      <Fragment key={lang}>{children}</Fragment>
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageApi {
  const api = useContext(LanguageContext);
  if (!api) throw new Error('useLanguage must be used inside LanguageProvider');
  return api;
}
