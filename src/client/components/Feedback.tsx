import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleCheck, Info, X } from 'lucide-react';
import { StatusGlyph } from './Icons';
import { Modal } from './Modal';

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside ToastProvider');
  return api;
}

let nextToastId = 1;

/**
 * Toasts live in a manual popover so they render in the top layer, above open
 * dialogs. Re-showing the popover when a toast arrives moves it to the front.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const hostRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextToastId++;
      setToasts((list) => [...list.slice(-3), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 4000);
    },
    [dismiss],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (toasts.length > 0) {
      if (host.matches(':popover-open')) host.hidePopover();
      host.showPopover();
    } else if (host.matches(':popover-open')) {
      host.hidePopover();
    }
  }, [toasts]);

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div ref={hostRef} popover="manual" className="toasts" role="region" aria-label="Notifications">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast" role={toast.kind === 'error' ? 'alert' : 'status'}>
            {toast.kind === 'success' && <CircleCheck size={17} color="var(--good)" aria-hidden />}
            {toast.kind === 'error' && <StatusGlyph tone="critical" size={17} />}
            {toast.kind === 'info' && <Info size={17} color="var(--accent-text)" aria-hidden />}
            <span>{toast.message}</span>
            <button type="button" className="icon-btn icon-btn-sm" onClick={() => dismiss(toast.id)} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Confirmation dialog
// ---------------------------------------------------------------------------

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) throw new Error('useConfirm must be used inside ConfirmProvider');
  return fn;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) => new Promise<boolean>((resolve) => setState({ ...options, resolve })),
    [],
  );

  const close = (result: boolean) => {
    state?.resolve(result);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={state !== null}
        onClose={() => close(false)}
        title={state?.title ?? ''}
        labelledBy="confirm-title"
        header={
          <div className="modal-header">
            <h2 id="confirm-title">{state?.title}</h2>
          </div>
        }
        footer={
          <>
            <button type="button" className="btn" onClick={() => close(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={`btn ${state?.danger ? 'btn-danger' : 'btn-primary'}`}
              onClick={() => close(true)}
              autoFocus
            >
              {state?.confirmLabel ?? 'Confirm'}
            </button>
          </>
        }
      >
        <div className="modal-body secondary">{state?.message}</div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg className="spinner" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Loading" role="img">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function PageLoading() {
  return (
    <div className="page-loading">
      <Spinner size={24} />
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div className="alert alert-error" role="alert">
      <StatusGlyph tone="critical" size={16} />
      <div className="stack" style={{ gap: 6 }}>
        <span>{message}</span>
        {onRetry && (
          <button type="button" className="link-button" onClick={onRetry} style={{ alignSelf: 'flex-start' }}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
