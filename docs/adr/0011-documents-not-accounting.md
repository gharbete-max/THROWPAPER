# ADR 0011 — Loppa renders and sends money documents; it does not do the accounting

**Status:** proposed — with one conflict in `main` that only the owner can resolve
**Date:** 2026-09-23

## Context

The expansion brief wants rent notices and invoices sent through Mailer, and draws the line:
*Loppa renders and sends documents from human-authored templates and data; it does not keep
ledgers, calculate tax, or claim bookkeeping compliance.*

That line agrees with `SPEC-forms.md` §8 (*"A ledger of record is out of scope"*) and with the
README (*"not accounting"*). **It does not agree with what is already shipped:**

| Already in `main` | Where | Against the brief's line? |
| --- | --- | --- |
| Invoices with lines, quantities in thousandths, bigint minor units, half-away-from-zero rounding | `packages/shared/src/invoicing/totals.ts`, `apps/api-forms/src/documents/invoice.ts` | No — this is rendering a document from data |
| Swedish OCR references with length digit and Luhn check | `packages/shared/src/invoicing/ocr.ts` | No — the brief asks for exactly this |
| An issuer-owned charge catalogue and standing per-recipient charges (monthly rent) | `packages/shared/src/invoicing/charges.ts`, `routes/invoices.ts` | No — human-authored data |
| **VAT per line** at a rate the author enters (`vatRateBasisPoints`) | `totals.ts`, `charges.ts` | **Borderline.** Multiplying by a rate a human typed is arithmetic, not tax determination. Choosing the rate, or defaulting one, would be tax |
| **A double-entry ledger**: accounts, append-only journal entries, reversals, trial balance | `packages/calc/src/ledger.ts`, `apps/api-forms/src/routes/ledger.ts` | **Yes.** It is a ledger, it is registered in `server.ts`, and it is sold |
| **The marketing site sells it**: *"A ledger you cannot edit"*; the about page says the same | `apps/forms/src/site/copy/*.ts` (`ledger`), `apps/forms/src/site/legal.ts:77` | **Yes** |

The ledger was built deliberately and well (commit `bc72d8a` and its predecessors; its header
explains the append-only rule). This ADR does not propose deleting it. It proposes that the
boundary be **decided**, because right now the spec, the README and the brief say one thing and
the product and the site say another.

## Decision (proposed)

### The boundary

Loppa **may**:

- render invoices, rent notices, payment reminders and receipts from human-authored templates and
  human-entered amounts;
- do exact arithmetic on those amounts (rule 5), including applying a VAT rate **the author
  entered** — never a rate Loppa chose, looked up or defaulted to non-zero;
- generate and validate payment references (Swedish OCR with length and check digit today; others,
  e.g. Norwegian KID or Finnish RF/viitenumero, only as each is asked for, each with its own check
  digit test);
- record that an invoice was issued, sent, viewed and — if a human marks it or a bank file says so
  — paid;
- export all of that (CSV, SIE later if asked) for the customer's real accounting system.

Loppa **does not**:

- decide what is taxable, at what rate, or under which rule; carry any VAT rate table; or produce
  VAT returns;
- claim compliance with Bokföringslagen, bogføringsloven, bokføringsloven or kirjanpitolaki, or
  describe itself as bookkeeping or accounting software;
- generate invoice terms, late-payment wording, legal notices or reminder texts (rule 8, ADR 0012)
  — those are the issuer's templates.

### The ledger: three options for the owner

1. **Keep it, renamed and bounded:** it stays as an *internal record of what was invoiced and paid*,
   with no claim to be a book of account. The site copy changes from "a ledger" to a description
   of that (the owner words it). Cheapest; the risk is that "trial balance" and double-entry still
   invite the claim this ADR refuses.
2. **Keep it as-is and move the line:** the owner decides Loppa *is* light accounting for
   associations. Then `SPEC-forms.md` §8, the README and this ADR change instead, and counsel
   reviews what the product may claim. Largest regulatory surface.
3. **Retire it behind a flag:** hidden from new organisations, data kept and exportable, routes
   kept read-only. Invoicing continues without it.

**Recommendation: option 1.** It keeps working code, removes the claim, and matches the brief. It
needs the owner's wording for the site copy; nothing will be rewritten until that exists.

### Where each piece runs

- Invoice data, charge catalogues and runs stay in **Forms** (they already live there).
- **Mailer sends** them through the contract (proposal in `docs/EXPANSION.md` §3): Forms confirms a
  run, then pushes a *document audience* — each member with a link to their own PDF — and Mailer
  sends it as a **rent / transactional** segment, which a marketing unsubscribe never stops
  (`SPEC-mailer.md` §3).
- **Recurring monthly rent** reuses the recurring logic twice, and deliberately so: Forms' run
  generates the month's invoices (with its existing confirmation step), Mailer's recurring schedule
  (B10) generates a *draft send* that a human approves. Two confirmations, one per product, because
  each product can run without the other.
- Test mode: an invoice run in test mode renders `TEST` on every page and sends only to the
  operator's own address — the same rule as every other outbound action.
