import type { BuilderGraph } from './schema.js';

/**
 * The guided conversation — slice S1's fifteen nodes, plus the menu every node can escape to and
 * the end (`docs/plan/BUILDER-GRAPH.md`, "The nodes of slice S1").
 *
 * **This is data, not code.** `graph.test.ts` proves it round-trips through JSON unchanged — no
 * functions, no `undefined`, nothing a server could not send. It is TypeScript rather than JSON
 * only so the compiler checks it as it is typed and so it can carry these comments (ADR 0021).
 *
 * Every string is a message key in `apps/forms/src/lib/messages`, in all twelve catalogues; the
 * words live there. `pnpm builder:validate` checks every key exists, every question is at most
 * nine words in English, and no banned word appears (rules G4, G10).
 *
 * **Scores** are millinats added to a template's belief when the option is chosen (ADR 0019). They
 * are guesses about evidence, set by a person and reviewed like any other number here: "signing
 * people up" is strong evidence for an event registration and weak evidence for an RSVP.
 *
 * **Two things wait for slice S5**, when the form schema gains the values they write: the `tab` and
 * `segmented` shapes (`ChoiceStyle` has no such shape yet, so offering them would write a value
 * the schema rejects — rule G5 refuses it), and the logo slot, which is kept in `pending` until
 * `FormSettings.layout` exists to hold it.
 */
export const BUILDER_GRAPH = {
  graphVersion: 1,
  start: 'flow.start',
  inputs: ['pending.brandKitExists', 'guess.pMille'],
  nodes: [
    {
      id: 'flow.start',
      group: 'flow',
      kind: 'question',
      ask: 'guided.flow.start.ask',
      help: 'guided.flow.start.help',
      next: 'guess.confirm',
      escape: 'menu.top',
      options: [
        {
          id: 'signup',
          label: 'guided.flow.start.signup',
          detail: 'guided.flow.start.signupDetail',
          icon: 'events',
          // Publishable from the first answer: every door adds a real question at once.
          patch: [
            { op: 'set', path: 'pending.purpose', value: 'signup' },
            {
              op: 'add',
              path: 'draft.definition.fields',
              value: {
                $newField: { type: 'short_text', word: 'name', key: 'name', required: true },
              },
            },
          ],
          score: {
            'event-registration': 400,
            'course-signup': 300,
            'conference-registration': 250,
            'general-meeting-registration': 200,
            rsvp: 200,
          },
        },
        {
          id: 'collect',
          label: 'guided.flow.start.collect',
          detail: 'guided.flow.start.collectDetail',
          icon: 'forms',
          patch: [
            { op: 'set', path: 'pending.purpose', value: 'collect' },
            {
              op: 'add',
              path: 'draft.definition.fields',
              value: {
                $newField: { type: 'short_text', word: 'name', key: 'name', required: true },
              },
            },
          ],
          score: {
            'member-details': 300,
            'job-application': 200,
            'quote-request': 150,
            'volunteer-signup': 150,
          },
        },
        {
          id: 'feedback',
          label: 'guided.flow.start.feedback',
          detail: 'guided.flow.start.feedbackDetail',
          icon: 'edit',
          patch: [
            { op: 'set', path: 'pending.purpose', value: 'feedback' },
            {
              op: 'add',
              path: 'draft.definition.fields',
              value: { $newField: { type: 'long_text', word: 'comments', key: 'comments' } },
            },
          ],
          score: {
            'customer-feedback': 400,
            'satisfaction-survey': 300,
            'suggestion-box': 200,
          },
        },
        {
          id: 'other',
          label: 'guided.flow.start.other',
          detail: 'guided.flow.start.otherDetail',
          icon: 'plus',
          patch: [
            { op: 'set', path: 'pending.purpose', value: 'other' },
            {
              op: 'add',
              path: 'draft.definition.fields',
              value: { $newField: { type: 'short_text', word: 'name', key: 'name' } },
            },
          ],
        },
      ],
    },
    {
      id: 'guess.confirm',
      group: 'guess',
      kind: 'confirm-guess',
      ask: 'guided.guess.ask',
      help: 'guided.guess.help',
      when: 'guess.pMille >= 800',
      skip: 'guided.skip.nothingToGuess',
      next: 'brand.start',
      escape: 'menu.top',
    },
    {
      id: 'brand.start',
      group: 'brand',
      kind: 'question',
      ask: 'guided.brand.start.ask',
      help: 'guided.brand.start.help',
      when: '!has(sidecar.brandDecided)',
      skip: 'guided.skip.brandDecided',
      next: [
        { when: 'pending.brandKitExists == true', to: 'brand.logoSlot' },
        { when: 'true', to: 'brand.quick' },
      ],
      escape: 'menu.siblings(brand)',
      negative: 'later',
      options: [
        {
          id: 'yes',
          label: 'guided.brand.start.yes',
          patch: [{ op: 'set', path: 'sidecar.brandDecided', value: 'organisation' }],
        },
        {
          id: 'later',
          label: 'guided.brand.start.later',
          patch: [{ op: 'set', path: 'sidecar.brandDecided', value: 'default' }],
          next: 'text.label',
        },
      ],
    },
    {
      id: 'brand.quick',
      group: 'brand',
      kind: 'pick-one',
      ask: 'guided.brand.quick.ask',
      help: 'guided.brand.quick.help',
      next: 'brand.logoSlot',
      escape: 'menu.siblings(brand)',
      // Loppa's own `default` look is not offered: a user's preview is never in Loppa's colours
      // (docs/plan/CAVEATS.md #32).
      options: [
        {
          id: 'minimal',
          label: 'guided.brand.quick.minimal',
          patch: [{ op: 'set', path: 'pending.themePreset', value: 'minimal' }],
        },
        {
          id: 'garden',
          label: 'guided.brand.quick.garden',
          patch: [{ op: 'set', path: 'pending.themePreset', value: 'garden' }],
        },
        {
          id: 'bold',
          label: 'guided.brand.quick.bold',
          patch: [{ op: 'set', path: 'pending.themePreset', value: 'bold' }],
        },
        {
          id: 'midnight',
          label: 'guided.brand.quick.midnight',
          patch: [{ op: 'set', path: 'pending.themePreset', value: 'midnight' }],
        },
      ],
    },
    {
      id: 'brand.logoSlot',
      group: 'brand',
      kind: 'pick-one',
      ask: 'guided.brand.logoSlot.ask',
      help: 'guided.brand.logoSlot.help',
      next: 'brand.preview',
      escape: 'menu.siblings(brand)',
      preview: 'brand.masthead',
      options: [
        {
          id: 'header-left',
          label: 'guided.brand.logoSlot.headerLeft',
          patch: [{ op: 'set', path: 'pending.logoSlot', value: 'header-left' }],
        },
        {
          id: 'masthead-centred',
          label: 'guided.brand.logoSlot.mastheadCentred',
          patch: [{ op: 'set', path: 'pending.logoSlot', value: 'masthead-centred' }],
        },
        {
          id: 'corner-watermark',
          label: 'guided.brand.logoSlot.cornerWatermark',
          patch: [{ op: 'set', path: 'pending.logoSlot', value: 'corner-watermark' }],
        },
        {
          id: 'footer-strip',
          label: 'guided.brand.logoSlot.footerStrip',
          patch: [{ op: 'set', path: 'pending.logoSlot', value: 'footer-strip' }],
        },
        {
          id: 'sidebar-rail',
          label: 'guided.brand.logoSlot.sidebarRail',
          patch: [{ op: 'set', path: 'pending.logoSlot', value: 'sidebar-rail' }],
        },
        {
          id: 'card-top',
          label: 'guided.brand.logoSlot.cardTop',
          patch: [{ op: 'set', path: 'pending.logoSlot', value: 'card-top' }],
        },
      ],
    },
    {
      id: 'brand.preview',
      group: 'brand',
      kind: 'preview-moment',
      ask: 'guided.preview.ask',
      help: 'guided.brand.preview.help',
      preview: 'brand.masthead',
      next: 'text.label',
      escape: 'menu.siblings(brand)',
    },
    {
      id: 'text.label',
      group: 'text',
      kind: 'text-entry',
      ask: 'guided.text.label.ask',
      help: 'guided.text.label.help',
      examples: [
        'guided.text.label.exampleName',
        'guided.text.label.exampleEmail',
        'guided.text.label.exampleDay',
      ],
      required: true,
      patch: [
        // A new question starts with no answer about buttons: the last question's must not leak.
        { op: 'set', path: 'pending.buttons', value: { $unset: true } },
        {
          op: 'add',
          path: 'draft.definition.fields',
          value: { $newField: { type: 'short_text' } },
        },
        { op: 'set', path: 'focus', value: { $lastAddedId: true } },
        { op: 'set', path: 'draft.definition.fields[focus].label', value: { $answer: true } },
      ],
      next: 'text.required',
      escape: 'menu.siblings(text)',
    },
    {
      id: 'text.required',
      group: 'text',
      kind: 'question',
      ask: 'guided.text.required.ask',
      help: 'guided.text.required.help',
      // Reachable from its sibling before any question exists (docs/plan/BUILDER-GRAPH.md,
      // "The machine": the walk found it).
      when: 'has(focus)',
      skip: 'guided.skip.noQuestion',
      next: 'choice.buttons',
      escape: 'menu.siblings(text)',
      negative: 'no',
      options: [
        {
          id: 'yes',
          label: 'guided.text.required.yes',
          patch: [{ op: 'set', path: 'draft.definition.fields[focus].required', value: true }],
        },
        {
          id: 'no',
          label: 'guided.text.required.no',
          patch: [{ op: 'set', path: 'draft.definition.fields[focus].required', value: false }],
        },
      ],
    },
    {
      id: 'choice.buttons',
      group: 'choice',
      kind: 'question',
      ask: 'guided.choice.buttons.ask',
      help: 'guided.choice.buttons.help',
      when: 'has(focus) && !decided(kind)',
      skip: [
        { when: '!has(focus)', skip: 'guided.skip.noQuestion' },
        { when: 'true', skip: 'guided.skip.decided' },
      ],
      next: 'choice.answers',
      escape: 'menu.siblings(choice)',
      negative: 'no',
      options: [
        {
          id: 'yes',
          label: 'guided.common.yes',
          icon: 'check',
          // Buttons from this answer on, one answer by default; "One answer or several?" refines
          // it. So every node after this one finds a choice to shape, however it is reached.
          patch: [
            { op: 'set', path: 'pending.buttons', value: true },
            { op: 'set', path: 'draft.definition.fields[focus].type', value: 'single_select' },
            { op: 'set', path: 'draft.definition.fields[focus].appearance', value: 'buttons' },
          ],
          score: { 'event-registration': 120, 'customer-feedback': 80 },
        },
        {
          id: 'no',
          label: 'guided.choice.buttons.no',
          patch: [
            { op: 'set', path: 'pending.buttons', value: false },
            { op: 'set', path: 'draft.definition.fields[focus].type', value: 'short_text' },
          ],
          next: 'flow.more',
        },
      ],
    },
    {
      id: 'choice.answers',
      group: 'choice',
      kind: 'question',
      ask: 'guided.choice.answers.ask',
      help: 'guided.choice.answers.help',
      when: 'pending.buttons == true',
      skip: 'guided.skip.noButtons',
      next: 'choice.count',
      escape: 'menu.siblings(choice)',
      options: [
        {
          id: 'one',
          label: 'guided.choice.answers.one',
          patch: [
            { op: 'set', path: 'draft.definition.fields[focus].type', value: 'single_select' },
            { op: 'set', path: 'draft.definition.fields[focus].appearance', value: 'buttons' },
          ],
        },
        {
          id: 'many',
          label: 'guided.choice.answers.many',
          patch: [
            { op: 'set', path: 'draft.definition.fields[focus].type', value: 'multi_select' },
            { op: 'set', path: 'draft.definition.fields[focus].appearance', value: 'buttons' },
          ],
        },
      ],
    },
    {
      id: 'choice.count',
      group: 'choice',
      kind: 'quantity',
      ask: 'guided.choice.count.ask',
      help: 'guided.choice.count.help',
      when: 'pending.buttons == true && !decided(options)',
      skip: [
        { when: 'pending.buttons != true', skip: 'guided.skip.noButtons' },
        { when: 'true', skip: 'guided.skip.decided' },
      ],
      min: 2,
      max: 12,
      default: 3,
      patch: [
        {
          op: 'set',
          path: 'draft.definition.fields[focus].options',
          value: { $options: { $answer: true } },
        },
      ],
      next: 'choice.shape',
      escape: 'menu.siblings(choice)',
    },
    {
      id: 'choice.shape',
      group: 'choice',
      kind: 'pick-one',
      ask: 'guided.choice.shape.ask',
      help: 'guided.choice.shape.help',
      when: 'pending.buttons == true && !decided(shape)',
      skip: [
        { when: 'pending.buttons != true', skip: 'guided.skip.noButtons' },
        { when: 'true', skip: 'guided.skip.decided' },
      ],
      next: 'choice.placement',
      escape: 'menu.siblings(choice)',
      preview: 'choice.control',
      options: [
        {
          id: 'pill',
          label: 'guided.choice.shape.pill',
          patch: [{ op: 'set', path: 'draft.definition.fields[focus].style.shape', value: 'pill' }],
        },
        {
          id: 'rounded',
          label: 'guided.choice.shape.rounded',
          patch: [
            { op: 'set', path: 'draft.definition.fields[focus].style.shape', value: 'rounded' },
          ],
        },
        {
          id: 'square',
          label: 'guided.choice.shape.square',
          patch: [
            { op: 'set', path: 'draft.definition.fields[focus].style.shape', value: 'square' },
          ],
        },
        {
          id: 'tile',
          label: 'guided.choice.shape.tile',
          // A tile is the `cards` appearance, which already exists — not a new shape.
          patch: [{ op: 'set', path: 'draft.definition.fields[focus].appearance', value: 'cards' }],
        },
      ],
    },
    {
      id: 'choice.placement',
      group: 'choice',
      kind: 'pick-one',
      ask: 'guided.choice.placement.ask',
      help: 'guided.choice.placement.help',
      when: 'pending.buttons == true',
      skip: 'guided.skip.noButtons',
      next: 'choice.preview',
      escape: 'menu.siblings(choice)',
      options: [
        {
          id: 'under-full',
          label: 'guided.choice.placement.underFull',
          patch: [
            { op: 'set', path: 'draft.definition.fields[focus].width', value: 'full' },
            { op: 'set', path: 'draft.definition.fields[focus].style.columns', value: '1' },
          ],
        },
        {
          id: 'row',
          label: 'guided.choice.placement.row',
          patch: [
            { op: 'set', path: 'draft.definition.fields[focus].style.columns', value: 'auto' },
          ],
        },
      ],
    },
    {
      id: 'choice.preview',
      group: 'choice',
      kind: 'preview-moment',
      ask: 'guided.preview.ask',
      help: 'guided.choice.preview.help',
      preview: 'choice.control',
      next: 'flow.more',
      escape: 'menu.siblings(choice)',
    },
    {
      id: 'flow.more',
      group: 'flow',
      kind: 'question',
      ask: 'guided.flow.more.ask',
      help: 'guided.flow.more.help',
      next: 'end',
      escape: 'menu.top',
      negative: 'no',
      options: [
        {
          id: 'yes',
          label: 'guided.flow.more.yes',
          patch: [],
          next: 'text.label',
        },
        { id: 'no', label: 'guided.flow.more.no', patch: [], next: 'end' },
      ],
    },
    {
      id: 'menu.top',
      group: 'menu',
      kind: 'menu',
      ask: 'guided.menu.top.ask',
      help: 'guided.menu.top.help',
      entries: ['flow.start', 'brand.start', 'text.label', 'choice.buttons', 'flow.more'],
      next: 'flow.more',
      escape: 'menu.top',
    },
    {
      id: 'end',
      group: 'flow',
      kind: 'end',
      ask: 'guided.end.ask',
      help: 'guided.end.help',
    },
  ],
} as const satisfies BuilderGraph;
