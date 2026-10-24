import { useLayoutEffect, useMemo, useRef, useState, type TextareaHTMLAttributes } from 'react';
import { splitMentions } from '../../../shared/notifications';
import type { User } from '../../../shared/types';
import { Avatar } from '../../components/Avatar';

/** A comment's text with @mentions of known people highlighted. */
export function MentionText({ text, people }: { text: string; people: User[] }) {
  const parts = useMemo(() => splitMentions(text, people), [text, people]);
  return (
    <>
      {parts.map((part, i) =>
        'person' in part ? (
          <span key={i} className="mention" title={part.person.name}>
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** The "@na" being typed just before the caret, if any. */
function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|[\s(])@([^\s@][^@\n]{0,30})?$/u.exec(before);
  if (!match) return null;
  const query = match[2] ?? '';
  // Stop suggesting once the typed text has two spaces or ends with punctuation.
  if ((query.match(/ /g) ?? []).length > 2 || /[.,;:!?]$/.test(query)) return null;
  return { start: before.length - query.length - 1, query };
}

interface MentionTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  people: User[];
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

/** A textarea that suggests people to mention after typing "@". */
export function MentionTextarea({ value, onChange, people, textareaRef, onKeyDown, ...props }: MentionTextareaProps) {
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? own;
  const [active, setActive] = useState<{ start: number; query: string } | null>(null);
  const [index, setIndex] = useState(0);
  // Where the caret goes after a mention is inserted. Set right after React updates the
  // text, before the next key press, so fast typing can't land in the wrong place.
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const pos = pendingCaret.current;
    if (pos === null) return;
    pendingCaret.current = null;
    ref.current?.focus();
    ref.current?.setSelectionRange(pos, pos);
  }, [value, ref]);

  const suggestions = useMemo(() => {
    if (!active) return [];
    const q = active.query.toLowerCase();
    return people
      .filter((p) => p.isActive && !p.invitePending)
      .filter((p) => {
        const name = p.name.toLowerCase();
        return name.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q));
      })
      .slice(0, 6);
  }, [active, people]);

  const refresh = (text: string, caret: number) => {
    const next = mentionQuery(text, caret);
    setActive(next);
    setIndex(0);
  };

  const pick = (person: User) => {
    if (!active) return;
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const insert = `@${person.name} `;
    const next = value.slice(0, active.start) + insert + value.slice(caret);
    pendingCaret.current = active.start + insert.length;
    onChange(next);
    setActive(null);
  };

  const open = active !== null && suggestions.length > 0;

  return (
    <div className="mention-wrap">
      <textarea
        {...props}
        ref={ref}
        value={value}
        aria-autocomplete="list"
        aria-expanded={open}
        onChange={(e) => {
          onChange(e.target.value);
          refresh(e.target.value, e.target.selectionStart);
        }}
        onClick={(e) => refresh(value, (e.target as HTMLTextAreaElement).selectionStart)}
        onBlur={() => setTimeout(() => setActive(null), 120)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => (i + 1) % suggestions.length);
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
              return;
            }
            if ((e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || e.key === 'Tab') {
              e.preventDefault();
              pick(suggestions[index]!);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setActive(null);
              return;
            }
          }
          onKeyDown?.(e);
        }}
      />
      {open && (
        <ul className="mention-list" role="listbox" aria-label="People to mention">
          {suggestions.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === index}
                className={`mention-option ${i === index ? 'is-active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p)}
              >
                <Avatar user={p} size="xs" title={null} />
                <span className="truncate">{p.name}</span>
                {p.title && <span className="muted truncate">{p.title}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
