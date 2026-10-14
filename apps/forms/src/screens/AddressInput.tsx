import { useCallback, useId, useState } from 'react';
import { useT } from '../lib/i18n.js';
import { useConfirm } from '../components/Confirm.js';
import {
  clearBook,
  forget as forgetEntry,
  loadBook,
  remember as rememberAddresses,
  suggest,
  type BookEntry,
} from '../lib/address-book.js';

/** The address book of this browser (`lib/address-book.ts`), as state. */
export function useAddressBook() {
  const [book, setBook] = useState<BookEntry[]>(() => loadBook());
  return {
    book,
    remember: useCallback(
      (addresses: readonly string[]) => setBook(rememberAddresses(addresses)),
      [],
    ),
    forget: useCallback((address: string) => setBook(forgetEntry(address)), []),
    clear: useCallback(() => {
      clearBook();
      setBook([]);
    }, []),
  };
}

export type AddressBook = ReturnType<typeof useAddressBook>;

const SEPARATOR = /[\s,;]+/;

/**
 * The "To" box: addresses typed or pasted, with recent ones suggested as you type. A combobox in
 * the usual keyboard sense: arrows move through the suggestions, Enter takes the highlighted one,
 * Escape closes them, and typing carries on as normal when none is highlighted.
 */
export function AddressInput({
  value,
  onChange,
  book,
  describedBy,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  book: readonly BookEntry[];
  describedBy: string;
  label: string;
}) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const typed = value.split(SEPARATOR).pop() ?? '';
  const options = open ? suggest(book, typed) : [];
  const expanded = options.length > 0;

  function pick(address: string) {
    onChange(`${value.slice(0, value.length - typed.length)}${address}, `);
    setOpen(false);
    setActive(-1);
  }

  return (
    <div className="combo">
      <textarea
        rows={3}
        role="combobox"
        aria-label={label}
        aria-describedby={describedBy}
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={`${id}-list`}
        aria-activedescendant={expanded && active >= 0 ? `${id}-${active}` : undefined}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (options.length === 0) return;
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActive((current) => (current + step + options.length) % options.length);
          } else if (event.key === 'Enter' && expanded && active >= 0) {
            event.preventDefault();
            pick(options[active]!);
          } else if (event.key === 'Escape' && expanded) {
            event.preventDefault();
            setOpen(false);
          }
        }}
      />
      <ul
        id={`${id}-list`}
        role="listbox"
        aria-label={t('book.label')}
        className="combo__list"
        hidden={!expanded}
      >
        {options.map((address, index) => (
          <li
            key={address}
            id={`${id}-${index}`}
            role="option"
            aria-selected={index === active}
            className="combo__option"
            // The box keeps focus: a click must not blur it before the choice is taken.
            onMouseDown={(event) => {
              event.preventDefault();
              pick(address);
            }}
          >
            {address}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What the book holds, with a way to forget one address or all of them (after asking). */
export function RecentAddresses({ book }: { book: AddressBook }) {
  const t = useT();
  const confirm = useConfirm();
  if (book.book.length === 0) return null;

  return (
    <details className="stack stack--tight" data-testid="address-book">
      <summary className="small">
        {t('book.label')} ({book.book.length})
      </summary>
      <p className="small muted">{t('book.hint')}</p>
      <ul className="stack stack--tight">
        {book.book.slice(0, 20).map((entry) => (
          <li key={entry.address} className="row small">
            <span>{entry.address}</span>
            <button
              type="button"
              className="button button--quiet small"
              aria-label={t('book.forget', { address: entry.address })}
              onClick={() => book.forget(entry.address)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <button
          type="button"
          className="button button--quiet small"
          onClick={() => {
            void confirm(t('book.clearAsk', { count: book.book.length }), {
              confirmLabel: t('book.clear'),
            }).then((yes) => yes && book.clear());
          }}
        >
          {t('book.clear')}
        </button>
      </div>
    </details>
  );
}
