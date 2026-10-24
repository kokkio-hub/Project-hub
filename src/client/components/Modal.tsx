import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Extra class on the <dialog>, e.g. "drawer" for the side panel. */
  className?: string;
  /** Header content shown instead of the default title + close button. */
  header?: ReactNode;
  labelledBy?: string;
}

/**
 * Accessible modal built on the native <dialog> element: focus is trapped
 * inside, Escape closes it, and the page behind is inert.
 */
export function Modal({ open, onClose, title, children, footer, wide, className, header, labelledBy }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleCancel = (event: Event) => {
      event.preventDefault();
      onCloseRef.current();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, []);

  // Close when clicking the backdrop (the dialog element itself, outside its content box).
  const pointerDownOnBackdrop = useRef(false);
  const isBackdrop = (event: React.PointerEvent<HTMLDialogElement> | React.MouseEvent<HTMLDialogElement>) => {
    const dialog = ref.current;
    if (!dialog || event.target !== dialog) return false;
    const rect = dialog.getBoundingClientRect();
    return (
      event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom
    );
  };

  const autoId = useId();
  const titleId = labelledBy ?? autoId;

  return (
    <dialog
      ref={ref}
      className={`${className ?? 'modal'} ${wide ? 'modal-wide' : ''}`}
      aria-labelledby={titleId}
      onPointerDown={(e) => {
        pointerDownOnBackdrop.current = isBackdrop(e);
      }}
      onClick={(e) => {
        if (pointerDownOnBackdrop.current && isBackdrop(e)) onClose();
        pointerDownOnBackdrop.current = false;
      }}
    >
      {open && (
        <>
          {header ?? (
            <div className="modal-header">
              <h2 id={titleId}>{title}</h2>
              <span className="spacer" />
              <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
                <X size={18} />
              </button>
            </div>
          )}
          {children}
          {footer && <div className="modal-footer">{footer}</div>}
        </>
      )}
    </dialog>
  );
}
