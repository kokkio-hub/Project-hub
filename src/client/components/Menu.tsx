import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface MenuProps {
  /** Renders the trigger button; spread the props onto a <button>. */
  trigger: (props: {
    ref: React.Ref<HTMLButtonElement>;
    onClick: () => void;
    'aria-haspopup': 'menu';
    'aria-expanded': boolean;
    'aria-controls': string;
  }) => ReactNode;
  children: ReactNode;
  align?: 'start' | 'end';
  /** Open upwards (for menus at the bottom of the screen). */
  placement?: 'below' | 'above';
}

/**
 * Dropdown menu on the Popover API: it renders in the top layer (so it also
 * works inside dialogs), closes on outside click or Escape, and supports arrow keys.
 */
export function Menu({ trigger, children, align = 'end', placement = 'below' }: MenuProps) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const position = useCallback(() => {
    const trigger = triggerRef.current;
    const m = menuRef.current;
    if (!trigger || !m) return;
    const r = trigger.getBoundingClientRect();
    const width = m.offsetWidth;
    const height = m.offsetHeight;
    let left = align === 'end' ? r.right - width : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = placement === 'above' ? r.top - height - 6 : r.bottom + 6;
    if (placement === 'below' && top + height > window.innerHeight - 8) top = Math.max(8, r.top - height - 6);
    if (placement === 'above' && top < 8) top = r.bottom + 6;
    m.style.left = `${left}px`;
    m.style.top = `${top}px`;
  }, [align, placement]);

  useEffect(() => {
    const m = menuRef.current;
    if (!m) return;
    const onToggle = (event: Event) => {
      const isOpen = (event as ToggleEvent).newState === 'open';
      setOpen(isOpen);
      if (!isOpen && document.activeElement && m.contains(document.activeElement)) triggerRef.current?.focus();
    };
    m.addEventListener('toggle', onToggle);
    return () => m.removeEventListener('toggle', onToggle);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    position();
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
    first?.focus();
    const reposition = () => position();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, position]);

  const toggle = () => {
    const m = menuRef.current;
    if (!m) return;
    if (m.matches(':popover-open')) m.hidePopover();
    else m.showPopover();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
    );
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
    } else if (event.key === 'Tab') {
      menuRef.current?.hidePopover();
    }
  };

  return (
    <>
      {trigger({
        ref: triggerRef,
        onClick: toggle,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': id,
      })}
      <div
        ref={menuRef}
        id={id}
        popover="auto"
        role="menu"
        className="menu"
        onKeyDown={onKeyDown}
        onClick={(event) => {
          // Close after choosing an item.
          if ((event.target as HTMLElement).closest('[role="menuitem"]')) menuRef.current?.hidePopover();
        }}
      >
        {open && children}
      </div>
    </>
  );
}

export function MenuItem({
  icon,
  children,
  onSelect,
  danger,
  disabled,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`menu-item ${danger ? 'danger' : ''}`}
      onClick={onSelect}
      disabled={disabled}
    >
      {icon}
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="menu-separator" role="separator" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="menu-label">{children}</div>;
}
