# Two products, one monorepo

|                       | **Formwork** (working name)                                     | **Sendwork** (working name)                     |
| --------------------- | --------------------------------------------------------------- | ----------------------------------------------- |
| What                  | Forms, inspections, measurements, registrations, reports        | Customised and recurring email campaigns        |
| Sells to              | Anyone who collects structured data and needs a report out      | Anyone with a list and something to say monthly |
| Depends on the other? | No. Uses Sendwork for mail if present, falls back to plain SMTP | No. Accepts audiences from anywhere             |
| Built by              | Track A                                                         | Track B, in parallel                            |

They are **separate products that integrate**, not one product with two halves. Either can be
sold, deployed and demoed without the other. The integration is a versioned HTTP contract, not a
shared database.

## Read in this order

0. **`docs/START-HERE.md` — the actual plan for the first six weeks. Start here, genuinely.**
1. `docs/CONTRACT.md` — the API between the two. **Freeze this before either track writes code.**
2. `docs/SPEC-shared.md` — packages both products import: tokens, i18n, grid, formulas, charts, auth.
3. `docs/SPEC-forms.md` — Track A.
4. `docs/SPEC-mailer.md` — Track B.
5. `docs/ROADMAP.md` — phases for both tracks and how to run them in parallel.

The specs below `START-HERE.md` are a destination, not a plan. Consult them when a decision has
long-term consequences; build what `START-HERE.md` says.

`CLAUDE.md` at the root is the short always-loaded version. Do not paste the specs into it.
