import type { Notification } from './types.js';

/** One plain sentence per notification, used in emails (the app styles its own). */
export function describeNotification(n: Pick<Notification, 'type' | 'data'>, actorName: string | null): string {
  const actor = actorName ?? 'Someone';
  const task = `“${n.data.taskTitle ?? 'a task'}”`;
  switch (n.type) {
    case 'assigned':
      return `${actor} assigned ${task} to you`;
    case 'mentioned':
      return `${actor} mentioned you on ${task}${n.data.excerpt ? `: ${n.data.excerpt}` : ''}`;
    case 'commented':
      return `${actor} commented on ${task}${n.data.excerpt ? `: ${n.data.excerpt}` : ''}`;
    case 'completed':
      return `${actor} completed ${task}`;
    case 'unblocked':
      return `${task} is ready to start: everything it was waiting for is done`;
    case 'due_soon':
      return `${task} is due tomorrow`;
    default:
      return `${actor} made a change to ${task}`;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds the people mentioned in a text as "@Full Name", or "@First" when no
 * one else shares that first name. Matching ignores case.
 */
export function findMentions<T extends { id: number; name: string }>(text: string, people: T[]): T[] {
  if (!text.includes('@')) return [];
  const firstNames = new Map<string, number>();
  for (const p of people) {
    const first = p.name.trim().split(/\s+/)[0]?.toLowerCase();
    if (first) firstNames.set(first, (firstNames.get(first) ?? 0) + 1);
  }
  const found: T[] = [];
  for (const person of people) {
    const full = person.name.trim();
    if (!full) continue;
    const first = full.split(/\s+/)[0]!;
    const names = [full];
    if (first !== full && firstNames.get(first.toLowerCase()) === 1) names.push(first);
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])@(${names.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_])`, 'iu');
    if (pattern.test(text)) found.push(person);
  }
  return found;
}

/** Splits a text into plain parts and mentions of known people, for highlighting. */
export function splitMentions<T extends { id: number; name: string }>(
  text: string,
  people: T[],
): ({ text: string } | { text: string; person: T })[] {
  if (!text.includes('@') || people.length === 0) return [{ text }];
  const firstNames = new Map<string, number>();
  for (const p of people) {
    const first = p.name.trim().split(/\s+/)[0]?.toLowerCase();
    if (first) firstNames.set(first, (firstNames.get(first) ?? 0) + 1);
  }
  const byName = new Map<string, T>();
  for (const p of people) {
    const full = p.name.trim();
    if (!full) continue;
    byName.set(full.toLowerCase(), p);
    const first = full.split(/\s+/)[0]!;
    if (first !== full && firstNames.get(first.toLowerCase()) === 1 && !byName.has(first.toLowerCase())) {
      byName.set(first.toLowerCase(), p);
    }
  }
  const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])@(${names.join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
  const parts: ({ text: string } | { text: string; person: T })[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index + match[1]!.length;
    if (start > last) parts.push({ text: text.slice(last, start) });
    const name = match[2]!;
    parts.push({ text: `@${text.slice(start + 1, start + 1 + name.length)}`, person: byName.get(name.toLowerCase())! });
    last = start + 1 + name.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
