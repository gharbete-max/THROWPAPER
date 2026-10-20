# Archive

Finished or superseded documents, moved here in the 2026-10 cleanup so `docs/` and `docs/plan/` hold
what is still being worked from. Nothing here is current guidance; git history keeps every earlier
version. Code comments and ADRs that name one of these files by bare name (`IMPORT-PIPELINE.md`,
`LAYOUT-IR.md`, `SPEC-mailer.md`, …) mean the copy in this folder.

| File | What it was |
| --- | --- |
| `START-HERE.md` | The first plan: three products, the phase-0 checkpoints. Superseded by `docs/VISION.md` and `docs/HANDOVER.md`. |
| `EXPANSION.md` | The expansion plan written beside START-HERE. Superseded by the Documents plan. |
| `SPEC-mailer.md` | Mailer's specification. Mailer is not built (the stubs were removed); its six exchanges stay in `docs/CONTRACT.md` and campaigns are built inside Send. |
| `plan/BELIEF.md` | The guided builder's guess (belief over templates), slice S11. Built. |
| `plan/BUILDER-GRAPH.md` | The conversation as data: node schema, `when`/`patch`/`score`, validation rules G0–G14. Built; `pnpm builder:validate` enforces it. |
| `plan/CONVERGENCE.md` | The two doors converge: import walk, paper twin, re-import (S12). Built. |
| `plan/IMPORT-PIPELINE.md` | The nine import stages, thresholds, debug JSON. Built. |
| `plan/INTENT-LADDER.md` | Free text to an answer, tiers T0–T8, learned aliases. Built. |
| `plan/LAYOUT-IR.md` | The frozen input of every import stage after extraction. Built. |
| `plan/POLISH.md` | S13: acceptance S1 by clicking alone, keyboard twins, budgets. Done. |
| `plan/SCANS.md` | S14: photographs and scans read on the device. Done. |
| `plan/ROADMAP.md` | The builder's slice-by-slice roadmap S1–S15. Done. |

Still live in `docs/plan/`: `PREDICTIVE-BUILDER.md`, `BRIEF.md`, `CAVEATS.md` and `NUMBERING-RULES.md`
(tests read the last two by path), plus the Documents, AI and design plans.
