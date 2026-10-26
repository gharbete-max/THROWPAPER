# ADR index

One line per decision; open a file only when its row matters. Generated from each file's title and Status line (2026-10-21); regenerate when an ADR changes status.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-theming-layers.md) | Theming layers, and what none of them may touch | accepted for the locked list, proposed for layers 2 and 3 |
| [0002](0002-administering-people.md) | Administering people, and what the product refuses to do about them | accepted |
| [0003](0003-repeating-groups.md) | Repeating groups, and what a CSV can still be afterwards | accepted |
| [0004](0004-old-forms-on-paper.md) | People have old forms, and most of them are PDFs | accepted 2026-09-16 — see "Decided" at the end |
| [0005](0005-dependency-majors.md) | Dependency majors, decided against for now | accepted 2026-09-22; extended 2026-09-22 (second batch) |
| [0006](0006-catalogue-direction.md) | One wizard across verticals, by composing blocks | accepted 2026-09-22 — the direction is the owner's, decided on paper the same day |
| [0009](0009-where-signing-lives.md) | Where signing lives, and what a signature is allowed to call itself | accepted 2026-09-23 — option (c), a third product, by the owner's decision. See |
| [0010](0010-eid-through-a-broker.md) | National eIDs through a broker, behind one interface | proposed — the broker itself is the owner's choice (`LAUNCH-CHECKLIST.md` §6) |
| [0011](0011-documents-not-accounting.md) | Loppa renders and sends money documents; it does not do the accounting | accepted 2026-10-14 (the conflict below was resolved by the owner on 2026-10-12; `invoicing` now owns its `Min |
| [0012](0012-human-authored-wording.md) | Signature, consent and payment wording is human-authored, versioned, and never generated | proposed |
| [0013](0013-ai-data-processing.md) | AI assistance: provider-agnostic, EU by default, opt-in, drafts only | superseded by ADR 0023 (a local, offline summary and translation model, on the person's |
| [0014](0014-mobile-stack.md) | The app: Capacitor around the existing web app, native only where it earns it | proposed |
| [0015](0015-reusing-open-source.md) | Reusing open source: take freely from permissive code, decide the licence first | accepted 2026-09-23 — Loppa is proprietary; see "Decided" at the end |
| [0016](0016-desktop-edition.md) | Loppa desktop (Windows and macOS): the whole Forms product on one computer, offline first | accepted 2026-09-23 — direction decided by the owner (see "Decided"); D1 built on |
| [0017](0017-guided-builder.md) | The guided builder: a conversation that patches a real draft | accepted 2026-10-06 by the owner's delegation ("Make all the decisions, pick the path that seems most logical" |
| [0018](0018-document-import.md) | Document import: rules may propose questions, a person confirms every one | accepted 2026-10-06 by the owner's delegation ("Make all the decisions, pick the path that seems most logical" |
| [0019](0019-deterministic-intent-ladder.md) | Reading free text and guessing templates by rules, in integers | accepted 2026-10-06 by the owner's delegation ("Make all the decisions, pick the path that seems most logical" |
| [0020](0020-graph-as-data.md) | The conversation is a validated graph of data | accepted 2026-10-06 by the owner's delegation ("Make all the decisions, pick the path that seems most logical" |
| [0021](0021-data-formats-json-not-yaml.md) | Data files are JSON or typed TypeScript, never YAML | accepted 2026-10-06 by the owner's delegation ("Make all the decisions, pick the path that seems most logical" |
| [0022](0022-the-room.md) | The room: three independent catchers, Documents first | accepted 2026-10-07 by the owner ("Let's go!"), with `docs/plan/DOCUMENTS.md` |
| [0023](0023-local-summary-model.md) | A local summary and translation model: one model, on the desktop, downloaded once | accepted — the owner chose the model on 2026-10-13; this ADR records what spike S1 measured |
| [0024](0024-ai-coordinator.md) | One AI coordinator for every Loppa: models as manifests, one resident at a time | proposed. Phase 2 of `docs/plan/AI-SYSTEM.md` (the coordinator foundation) is built under it; the vision |
| [0025](0025-single-multimodal-model.md) | One multimodal model for everything, run by a pinned llama-server, shipped as an AI pack | accepted — the owner's decision of 2026-10-19. The migration is built; reading a page |
| [0026](0026-offline-first-launch-position.md) | The launch position: offline first, the network only on a confirmed action | accepted 2026-10-20 (the owner asked that the open product decisions be made from the |
| [0027](0027-next-catchers.md) | The next two catchers: Spreadsheets, then Presentation & planning, on what Documents proved | proposed 2026-10-26 |
