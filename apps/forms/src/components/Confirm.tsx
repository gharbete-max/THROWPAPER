import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../lib/i18n.js';

/**
 * Confirmation that actually appears.
 *
 * Every destructive action in this app used to be gated behind `window.confirm`. In an embedded
 * browser — a desktop app's webview, an in-app browser, anything that suppresses native dialogs —
 * `window.confirm` returns `false` without showing anything, so the action silently does nothing.
 * That is exactly how "removing parts of the form doesn't work" was reported, and the same fault
 * was quietly disabling archive, restore and the publish override.
 *
 * `CLAUDE.md` rule 7 requires a confirmation step before anything is deleted or sent. It does not
 * require it to be a native dialog, and a native dialog turns out to be the one implementation
 * that cannot be relied on. This is a real `<dialog>`: it renders in the page, it is styled like
 * the rest of the product, Escape cancels it, and focus goes to the safe option.
 */
type Ask = (
  message: string,
  options?: { confirmLabel?: string; danger?: boolean },
) => Promise<boolean>;

const ConfirmContext = createContext<Ask>(async () => false);

interface Pending {
  message: string;
  confirmLabel?: string;
  danger: boolean;
  resolve: (answer: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [pending, setPending] = useState<Pending | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const ask = useCallback<Ask>(
    (message, options) =>
      new Promise<boolean>((resolve) => {
        setPending({
          message,
          confirmLabel: options?.confirmLabel,
          danger: options?.danger ?? true,
          resolve,
        });
      }),
    [],
  );

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (pending && !element.open) element.showModal();
    if (!pending && element.open) element.close();
  }, [pending]);

  function answer(value: boolean) {
    pending?.resolve(value);
    setPending(null);
  }

  return (
    <ConfirmContext.Provider value={ask}>
      {children}

      <dialog
        ref={dialog}
        className="confirm"
        aria-label={t('confirm.title')}
        // Escape and the backdrop both mean "no". The browser fires `cancel` for Escape; without
        // this the promise would never settle and the caller would hang forever.
        onCancel={(event) => {
          event.preventDefault();
          answer(false);
        }}
        onClose={() => pending && answer(false)}
      >
        {pending && (
          <div className="stack">
            <p>{pending.message}</p>
            <div className="row row--between">
              {/* The safe option first and focused, because this is the one people reach for. */}
              <button
                type="button"
                className="button button--quiet"
                autoFocus
                onClick={() => answer(false)}
              >
                {t('confirm.cancel')}
              </button>
              <button
                type="button"
                className={pending.danger ? 'button button--danger' : 'button'}
                onClick={() => answer(true)}
              >
                {pending.confirmLabel ?? t('confirm.confirm')}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): Ask {
  return useContext(ConfirmContext);
}
