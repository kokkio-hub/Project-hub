import fs from 'node:fs';
import path from 'node:path';
import type { Catalog, CatalogEntry } from '../src/shared/i18n/core.js';

/** Reads the source code and collects the English text that needs a translation. */

const root = path.resolve(import.meta.dirname, '..');

export function filesIn(dir: string): string[] {
  return fs
    .readdirSync(path.join(root, dir), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => path.join(e.parentPath, e.name));
}

// --- A tiny scanner for string literals -----------------------------------------------------

/** Reads the string literal starting at `i` (', " or `). Template parts ${...} become {}. */
function readString(src: string, i: number): { value: string; end: number; template: boolean } {
  const quote = src[i]!;
  let value = '';
  let j = i + 1;
  while (j < src.length && src[j] !== quote) {
    if (src[j] === '\\') {
      const next = src[j + 1]!;
      value += next === 'n' ? '\n' : next;
      j += 2;
      continue;
    }
    if (quote === '`' && src[j] === '$' && src[j + 1] === '{') {
      let depth = 1;
      j += 2;
      while (j < src.length && depth > 0) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
        else if (src[j] === "'" || src[j] === '"' || src[j] === '`') j = readString(src, j).end;
        j++;
      }
      value += '{}';
      continue;
    }
    value += src[j];
    j++;
  }
  return { value, end: j, template: quote === '`' };
}

/** String literals among the arguments of the call whose "(" is at `open`. */
function callStrings(src: string, open: number): { topLevel: string[]; all: string[] } {
  const topLevel: string[] = [];
  const all: string[] = [];
  const stack: string[] = [];
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (c === "'" || c === '"' || c === '`') {
      const s = readString(src, i);
      // Object keys like { 'a-b': 1 } are rare here; values are what we want.
      all.push(s.value);
      if (stack.length === 1) topLevel.push(s.value);
      i = s.end;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i);
      continue;
    }
    if (c === '(' || c === '[' || c === '{') stack.push(c);
    else if (c === ')' || c === ']' || c === '}') {
      stack.pop();
      if (stack.length === 0) break;
    }
  }
  return { topLevel, all };
}

const words = (s: string) => /[A-Za-z]{2,}/.test(s);
export const shape = (s: string) => s.replace(/\{\w*\}/g, '{}');

function lookup(catalog: Catalog, key: string): CatalogEntry | undefined {
  return catalog[key];
}

export function missingIn(catalog: Catalog, keys: Iterable<string>): string[] {
  return [...new Set(keys)].filter((k) => lookup(catalog, k) === undefined).sort();
}

// --- Keys used by the web app -----------------------------------------------------------------

export function clientKeys(): { plain: Set<string>; counted: Set<string>; problems: string[] } {
  const plain = new Set<string>();
  const counted = new Set<string>();
  const problems: string[] = [];
  for (const file of filesIn('src/client')) {
    if (file.includes(`${path.sep}i18n${path.sep}`)) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\b(t|tx|N_|tn)\(\s*(?=['"`])/g)) {
      const open = m.index! + m[1]!.length;
      const { topLevel } = callStrings(src, open);
      const first = topLevel[0];
      if (first === undefined) continue;
      if (first.includes('{}')) problems.push(`${path.relative(root, file)}: template literal as a key: ${first}`);
      if (m[1] === 'tn') counted.add(first);
      else plain.add(first);
    }
  }
  return { plain, counted, problems };
}

// --- Keys used by shared code and the server ---------------------------------------------------

export function translatorKeys(dirs: string[]): { plain: Set<string>; counted: Set<string> } {
  const plain = new Set<string>();
  const counted = new Set<string>();
  for (const dir of dirs) {
    for (const file of filesIn(dir)) {
      if (file.includes(`${path.sep}i18n${path.sep}`) || file.endsWith('seed.ts') || file.endsWith('cli.ts')) continue;
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\btr\.(t|tn)\(\s*(?=['"`])/g)) {
        const open = m.index! + 3 + m[1]!.length;
        const first = callStrings(src, open).topLevel[0];
        if (first === undefined) continue;
        (m[1] === 'tn' ? counted : plain).add(first);
      }
    }
  }
  return { plain, counted };
}

/** Messages the server sends in errors: written in English and translated on the way out. */
export function serverMessages(): Set<string> {
  // The defaults and fallbacks in lib/errors.ts.
  const out = new Set<string>([
    'Please sign in to continue.',
    'You don’t have permission to do that.',
    '{what} not found.',
    'The request body is not valid JSON.',
    'The request is too large.',
    'Something went wrong on the server. Please try again.',
  ]);
  for (const file of filesIn('src/server')) {
    if (file.includes(`${path.sep}i18n${path.sep}`) || file.endsWith('seed.ts') || file.endsWith('cli.ts')) continue;
    if (file.endsWith(`lib${path.sep}errors.ts`)) continue;
    const src = fs.readFileSync(file, 'utf8');
    // Error helpers: every string in the call is shown to people (the message and field messages).
    for (const m of src.matchAll(/\b(badRequest|forbidden|notFound|conflict|unauthorized|new HttpError|new FieldValueError)\(/g)) {
      const { all } = callStrings(src, m.index! + m[0].length - 1);
      for (const s of all) if (words(s)) out.add(s);
    }
    // Zod messages: the string arguments of validation calls, and { message } options.
    for (const m of src.matchAll(/\.(min|max|email|date|regex|length|refine|int|positive|nonnegative)\(|\bz\.(enum|email|iso\.date)\(/g)) {
      const { topLevel } = callStrings(src, m.index! + m[0].length - 1);
      for (const s of topLevel.slice(m[2] === 'enum' ? 0 : 0)) if (words(s) && /\s/.test(s)) out.add(s);
    }
    for (const m of src.matchAll(/\bmessage:\s*(?=['"`])/g)) {
      const s = readString(src, m.index! + m[0].length);
      if (words(s.value)) out.add(s.value);
    }
  }
  return out;
}

/** Words put into "{what} not found." and similar, which are translated too. */
export function substitutedWords(): Set<string> {
  const out = new Set<string>();
  for (const file of filesIn('src/server')) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bnotFound\('([^']+)'\)|\bparseId\([^,()]+(?:\([^)]*\))?, '([^']+)'\)|\bassertManager\(req, [\w.!]+, '([^']+)'\)/g)) {
      out.add((m[1] ?? m[2] ?? m[3])!);
    }
  }
  out.add('id'); // parseId's default
  out.add('change project settings'); // assertManager's default
  out.add('Item'); // notFound's default
  return out;
}

