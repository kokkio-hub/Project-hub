/**
 * Translations, gettext style: the English text is the key, and a catalog maps
 * it to the other language. Text with no entry stays English, so a missing
 * translation never breaks a screen (a test checks the catalogs are complete).
 *
 *   t('Delete task')                                  → "Taak verwijderen"
 *   t('Due {date}', { date })                         → "Deadline 3 okt"
 *   tn('{count} task', '{count} tasks', n)            → "1 taak" / "4 taken"
 */

export const LANGUAGES = ['en', 'nl'] as const;
export type Lang = (typeof LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<Lang, string> = { en: 'English', nl: 'Nederlands' };

/** BCP 47 locale used for numbers, times and sorting. */
export const LOCALES: Record<Lang, string> = { en: 'en-GB', nl: 'nl-NL' };

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** Picks a supported language from an Accept-Language header or navigator.languages. */
export function pickLanguage(candidates: readonly string[] | string | null | undefined): Lang | null {
  const list = typeof candidates === 'string' ? candidates.split(',') : (candidates ?? []);
  for (const raw of list) {
    const code = raw.trim().split(';')[0]!.toLowerCase().split('-')[0];
    if (isLang(code)) return code;
  }
  return null;
}

/** A catalog entry is the translation, or [singular, plural] for counted text. */
export type CatalogEntry = string | readonly [string, string];
export type Catalog = Readonly<Record<string, CatalogEntry>>;

export type Params = Record<string, string | number | null | undefined>;

export interface Translator {
  readonly lang: Lang;
  readonly locale: string;
  /** Translates `text`, filling in {placeholders} from `params`. */
  t(text: string, params?: Params): string;
  /** Counted text: `one` when count is 1, otherwise `other`. {count} is filled in too. */
  tn(one: string, other: string, count: number, params?: Params): string;
}

/** Marks a string for translation without translating it (for constants defined before the language is known). */
export function N_<T extends string>(text: T): T {
  return text;
}

export function formatNumber(value: number, lang: Lang): string {
  return value.toLocaleString(LOCALES[lang]);
}

/** Fills in {name} placeholders. Numbers are formatted for the language. Unknown placeholders stay as they are. */
export function interpolate(template: string, params: Params | undefined, lang: Lang): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (!(name in params)) return match;
    const value = params[name];
    if (value === null || value === undefined) return '';
    return typeof value === 'number' ? formatNumber(value, lang) : value;
  });
}

export function makeTranslator(lang: Lang, catalog: Catalog): Translator {
  const lookup = (text: string): CatalogEntry | undefined => (lang === 'en' ? undefined : catalog[text]);
  return {
    lang,
    locale: LOCALES[lang],
    t(text, params) {
      const entry = lookup(text);
      const template = typeof entry === 'string' ? entry : Array.isArray(entry) ? entry[0] : text;
      return interpolate(template, params, lang);
    },
    tn(one, other, count, params) {
      const entry = lookup(one);
      const forms: readonly [string, string] = Array.isArray(entry) ? (entry as readonly [string, string]) : [one, other];
      const template = count === 1 ? forms[0] : forms[1];
      return interpolate(template, { count, ...params }, lang);
    },
  };
}

/** The identity translator, for code that runs without a language (tests, logs). */
export const english: Translator = makeTranslator('en', {});
