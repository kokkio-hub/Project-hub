import { describe, expect, it } from 'vitest';
import { clientNl } from '../src/client/i18n/nl.js';
import { makeTranslator, type Catalog } from '../src/shared/i18n/core.js';
import { sharedNl } from '../src/shared/i18n/nl.js';
import { serverNl } from '../src/server/i18n/nl.js';
import { translateMessage } from '../src/server/i18n/index.js';
import { PROJECT_STATUS_LABELS, TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, USER_ROLE_LABELS } from '../src/shared/types.js';
import { clientKeys, missingIn, serverMessages, shape, substitutedWords, translatorKeys } from './i18nScan.js';

/**
 * Every piece of interface text must have a Dutch translation. These tests read
 * the source code, collect the English keys, and check the catalogs.
 */

// --- Tests ---------------------------------------------------------------------------------------

const clientCatalog: Catalog = { ...sharedNl, ...clientNl };
const serverCatalog: Catalog = { ...sharedNl, ...serverNl };

describe('Dutch translations', () => {
  it('cover every text in the web app', () => {
    const { plain, counted, problems } = clientKeys();
    expect(problems).toEqual([]);
    expect(missingIn(clientCatalog, plain)).toEqual([]);
    expect(missingIn(clientCatalog, counted)).toEqual([]);
    for (const key of counted) expect(Array.isArray(clientCatalog[key]), `"${key}" needs [singular, plural]`).toBe(true);
  });

  it('cover shared text (both sides use it)', () => {
    const { plain, counted } = translatorKeys(['src/shared']);
    expect(missingIn(sharedNl, plain)).toEqual([]);
    expect(missingIn(sharedNl, counted)).toEqual([]);
    for (const key of counted) expect(Array.isArray(sharedNl[key]), `"${key}" needs [singular, plural]`).toBe(true);
    const labels = [TASK_STATUS_LABELS, TASK_PRIORITY_LABELS, PROJECT_STATUS_LABELS, USER_ROLE_LABELS].flatMap((m) => Object.values(m));
    expect(missingIn(sharedNl, labels)).toEqual([]);
  });

  it('cover the server’s emails, exports and messages', () => {
    const { plain, counted } = translatorKeys(['src/server']);
    expect(missingIn(serverCatalog, plain)).toEqual([]);
    expect(missingIn(serverCatalog, counted)).toEqual([]);

    const shapes = new Set(Object.keys(serverCatalog).map(shape));
    const missing = [...serverMessages()].filter((m) => !shapes.has(shape(m))).sort();
    expect(missing).toEqual([]);
    expect(missingIn(serverCatalog, substitutedWords())).toEqual([]);
  });

  it('keep the same {placeholders} as the English text', () => {
    const names = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
    for (const [key, value] of Object.entries({ ...clientCatalog, ...serverCatalog })) {
      const forms = Array.isArray(value) ? value : [value];
      for (const form of forms) {
        // A counted form may leave out {count} ("Every week" / "Elke week").
        const expected = names(key).filter((n) => !(Array.isArray(value) && n === 'count'));
        const actual = names(form as string).filter((n) => !(Array.isArray(value) && n === 'count'));
        expect(actual, `placeholders in "${key}"`).toEqual(expected);
      }
    }
  });

  it('translate finished server messages, including the words filled in', () => {
    expect(translateMessage('Task not found.', 'nl')).toBe('Taak niet gevonden.');
    expect(translateMessage('Invalid task id.', 'nl')).toBe('Ongeldig taak-id.');
    expect(translateMessage('title: Use at most 200 characters', 'nl')).toBe('title: Gebruik maximaal 200 tekens');
    expect(translateMessage('Task not found.', 'en')).toBe('Task not found.');
    expect(translateMessage('Some message nobody wrote down', 'nl')).toBe('Some message nobody wrote down');
  });

  it('count in Dutch', () => {
    const tr = makeTranslator('nl', clientCatalog);
    expect(tr.tn('{count} task', '{count} tasks', 1)).toBe('1 taak');
    expect(tr.tn('{count} task', '{count} tasks', 3)).toBe('3 taken');
    expect(tr.t('{count} overdue', { count: 1200 })).toBe('1.200 te laat');
  });
});
