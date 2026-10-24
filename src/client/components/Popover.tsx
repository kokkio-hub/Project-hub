import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface PopoverProps {
  /** Renders the trigger button; spread the props onto a <button>. */
  trigger: (props: {
    ref: React.Ref<HTMLButtonElement>;
    onClick: () => void;
    'aria-haspopup': 'dialog';
    'aria-expanded': boolean;
    'aria-controls': string;
  }) => ReactNode;
  /** Content; receives a function that closes the popover. */
  children: (close: () => void) => ReactNode;
  label: string;
  align?: 'start' | 'end';
  width?: number;
  className?: string;
}

/**
 * A small panel anchored to a button (label picker, notifications), on the
 * Popover API like the menus: top layer, closes on outside click or Escape.
 */
export function Popover({ trigger, children, label, align = 'start', width = 280, className }: PopoverProps) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const position = useCallback(() => {
    const t = triggerRef.current;
    const p = panelRef.current;
    if (!t || !p) return;
    const r = t.getBoundingClientRect();
    const w = Math.min(width, window.innerWidth - 16);
    p.style.width = `${w}px`;
    let left = align === 'end' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    const height = p.offsetHeight;
    let top = r.bottom + 6;
    if (top + height > window.innerHeight - 8) top = Math.max(8, r.top - height - 6);
    p.style.left = `${left}px`;
    p.style.top = `${top}px`;
  }, [align, width]);

  useEffect(() => {
    const p = panelRef.current;
    if (!p) return;
    const onToggle = (event: Event) => {
      const isOpen = (event as ToggleEvent).newState === 'open';
      setOpen(isOpen);
      if (!isOpen && document.activeElement && p.contains(document.activeElement)) triggerRef.current?.focus();
    };
    p.addEventListener('toggle', onToggle);
    return () => p.removeEventListener('toggle', onToggle);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    position();
    const first = panelRef.current?.querySelector<HTMLElement>('[data-autofocus], input, button, [tabindex="0"]');
    first?.focus();
    const reposition = () => position();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    const observer = new ResizeObserver(reposition);
    if (panelRef.current) observer.observe(panelRef.current);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      observer.disconnect();
    };
  }, [open, position]);

  const close = useCallback(() => panelRef.current?.hidePopover(), []);
  const toggle = () => {
    const p = panelRef.current;
    if (!p) return;
    if (p.matches(':popover-open')) p.hidePopover();
    else p.showPopover();
  };

  return (
    <>
      {trigger({ ref: triggerRef, onClick: toggle, 'aria-haspopup': 'dialog', 'aria-expanded': open, 'aria-controls': id })}
      <div ref={panelRef} id={id} popover="auto" role="dialog" aria-label={label} className={`popover ${className ?? ''}`}>
        {open && children(close)}
      </div>
    </>
  );
}
