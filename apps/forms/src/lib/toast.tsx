import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Confirmation and failure, without moving the page.
 *
 * Saving a form said so by swapping a label in place — invisible if you had already looked away —
 * and a failed save had nowhere to go at all. Both are the same missing thing: a place for the app
 * to speak that is not part of the layout.
 *
 * ## Announced, not just drawn
 *
 * The strip is an `aria-live` region, so a screen reader hears "Saved" without the focus moving.
 * `polite` for ordinary confirmations, and `assertive` only for errors — a live region that
 * interrupts on every success trains people to turn it off.
 */
export type ToastTone = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  text: string;
  tone: ToastTone;
}

interface ToastValue {
  show: (text: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastValue>({ show: () => {} });

/** How long a toast stays. Errors stay longer, because they are read rather than glanced at. */
const LIFETIME: Record<ToastTone, number> = { info: 4000, success: 3000, error: 7000 };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((text: string, tone: ToastTone = 'info') => {
    // Date.now() would collide for two toasts raised in the same millisecond, which React would
    // then treat as one element and animate wrongly.
    const id = nextId();
    setToasts((current) => [...current, { id, text, tone }]);
    setTimeout(
      () => setToasts((current) => current.filter((toast) => toast.id !== id)),
      LIFETIME[tone],
    );
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts">
        {(['polite', 'assertive'] as const).map((liveness) => (
          /**
           * Two regions, because a region's `aria-live` is read when the region is *created*, not
           * when it changes. One region whose politeness flips per toast is a region whose
           * politeness is whatever it was on first render.
           */
          <div key={liveness} aria-live={liveness} className="stack">
            {toasts
              .filter((toast) => (liveness === 'assertive') === (toast.tone === 'error'))
              .map((toast) => (
                <div key={toast.id} className={`toast toast--${toast.tone}`}>
                  <span className="toast__text">{toast.text}</span>
                </div>
              ))}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  return useContext(ToastContext);
}

let counter = 0;
function nextId(): number {
  counter += 1;
  return counter;
}
