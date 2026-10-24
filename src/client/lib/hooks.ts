import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

/** Opens the task drawer for a task by adding ?task=<id> to the current URL (so it can be shared). */
export function useOpenTask(): (id: number) => void {
  const [, setSearchParams] = useSearchParams();
  return useCallback(
    (id: number) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('task', String(id));
        return next;
      });
    },
    [setSearchParams],
  );
}

/** Returns a value that only updates after it stops changing for `delay` ms. */
export function useDebounced<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Grows a textarea with its content. */
export function useAutosize(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return ref;
}

/** Re-renders every `ms` milliseconds (for "5 min ago" labels). */
export function useNow(ms = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
  return now;
}
