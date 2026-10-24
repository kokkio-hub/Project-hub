import type { Request } from 'express';
import { isLang, makeTranslator, pickLanguage, type Lang, type Translator } from '../../shared/i18n/core.js';
import { sharedNl } from '../../shared/i18n/nl.js';
import { serverNl } from './nl.js';

export type { Lang, Translator };

const nlCatalog = { ...sharedNl, ...serverNl };
const translators: Record<Lang, Translator> = {
  en: makeTranslator('en', {}),
  nl: makeTranslator('nl', nlCatalog),
};

export function trFor(lang: Lang): Translator {
  return translators[lang];
}

/** The language for a request: the app's header, else the person's settings, else the browser's, else the default. */
export function requestLanguage(
  req: Request,
  defaultLanguage: Lang | null,
  user?: { language: string | null; ui_language: string | null } | null,
): Lang {
  const header = req.get('x-client-lang');
  if (isLang(header)) return header;
  if (user) return userLanguage(user, defaultLanguage);
  return defaultLanguage ?? pickLanguage(req.get('accept-language')) ?? 'en';
}

/** A person's language for emails and the calendar feed: their choice, else what they last used the app in. */
export function userLanguage(user: { language: string | null; ui_language: string | null }, defaultLanguage: Lang | null): Lang {
  if (isLang(user.language)) return user.language;
  if (isLang(user.ui_language)) return user.ui_language;
  return defaultLanguage ?? 'en';
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * Error messages are written in English where they're thrown (often with
 * names filled in). They're translated on the way out: an exact catalog match,
 * or a catalog key with {placeholders} that matches the finished text.
 * Placeholders named {what} hold a word that is translated too ("Task").
 */
interface Pattern {
  regex: RegExp;
  names: string[];
  key: string;
}

const fixedLength = (key: string) => key.replace(/\{\w+\}/g, '').length;
const patterns: Pattern[] = Object.entries(nlCatalog)
  // Counted entries ("{count} project") are never whole messages.
  .filter(([key, value]) => typeof value === 'string' && /\{\w+\}/.test(key))
  .map(([key]) => key)
  // The most specific pattern (the most fixed text) wins.
  .sort((a, b) => fixedLength(b) - fixedLength(a))
  .map((key) => {
    const names: string[] = [];
    const source = key
      .split(/(\{\w+\})/g)
      .map((piece) => {
        const m = /^\{(\w+)\}$/.exec(piece);
        if (m) {
          names.push(m[1]!);
          return '(.+?)';
        }
        return piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('');
    return { regex: new RegExp(`^${source}$`, 's'), names, key };
  });

export function translateMessage(message: string, lang: Lang): string {
  if (lang === 'en' || !message) return message;
  const tr = translators[lang];
  const exact = nlCatalog[message];
  if (exact !== undefined) return tr.t(message);
  for (const pattern of patterns) {
    const match = pattern.regex.exec(message);
    if (!match) continue;
    const params: Record<string, string> = {};
    pattern.names.forEach((name, i) => {
      const value = match[i + 1]!;
      params[name] = name === 'what' ? tr.t(value) : value;
    });
    return tr.t(pattern.key, params);
  }
  // Validation messages look like "field: message" (or "Custom field name: message").
  const field = /^([^:\n]{1,60}?): (.+)$/s.exec(message);
  if (field) {
    const rest = translateMessage(field[2]!, lang);
    if (rest !== field[2]) return `${field[1]}: ${rest}`;
  }
  return message;
}

export function translateFields(fields: Record<string, string> | undefined, lang: Lang): Record<string, string> | undefined {
  if (!fields || lang === 'en') return fields;
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, translateMessage(value, lang)]));
}
