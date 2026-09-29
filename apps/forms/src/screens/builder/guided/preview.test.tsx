import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { LocaleConfig } from '@tp/i18n';
import {
  BUILDER_GRAPH,
  answer,
  begin,
  edit,
  type Answer,
  type Conversation,
} from '@tp/shared/builder';
import { emptyDefinition } from '@tp/shared/forms';
import { messages } from '../../../lib/messages/all.js';
import { PreviewMoment, type PreviewBrand } from './PreviewMoment.js';
import { Shell } from './Shell.js';

/**
 * The preview moment, rendered — `CAVEATS.md` #31 (`preview-must-be-real`), #32
 * (`brand-before-build`) and the fixed sentences of `DESIGN-LANGUAGE.md`. No DOM here: static
 * renders of real conversations; clicking and dragging are pressed in `e2e/guided-builder.spec.ts`.
 */

vi.mock('../../../lib/i18n.js', async () => {
  const { createTranslator } = await import('@tp/i18n');
  const { messages: all } = await import('../../../lib/messages/all.js');
  const t = createTranslator({ supported: ['en-GB'], default: 'en-GB' }, all, 'en-GB');
  return { useT: () => t };
});

const G = BUILDER_GRAPH;
const locale = 'en-GB';
const organisation: LocaleConfig = { supported: ['en-GB'], default: 'en-GB' };
const en = (key: string) => messages[key]!['en-GB']!;
const kit: PreviewBrand = { customised: true, logo: null, organisationName: 'Demo AB' };

/** The buttons chain to "Where should they sit?", where the control is shown. */
function atPlacement(): Conversation {
  return (
    [
      { kind: 'option', optionId: 'signup' },
      { kind: 'option', optionId: 'unsure' },
      { kind: 'option', optionId: 'unsure' },
      { kind: 'option', optionId: 'later' },
      { kind: 'text', value: 'Which day suits you?' },
      { kind: 'option', optionId: 'yes' },
      { kind: 'option', optionId: 'yes' },
      { kind: 'option', optionId: 'one' },
      { kind: 'quantity', value: 3 },
      { kind: 'option', optionId: 'pill' },
    ] as Answer[]
  ).reduce(
    (c, given) => answer(G, c, given, { locale }),
    begin(G, { definition: emptyDefinition, title: {}, pending: { brandKitExists: true } }),
  );
}

const preview = (
  conversation: Conversation,
  overrides: Partial<Parameters<typeof PreviewMoment>[0]> = {},
) =>
  renderToStaticMarkup(
    <PreviewMoment
      spec="choice.control"
      graph={G}
      conversation={conversation}
      contentLocales={organisation}
      contentLocale={locale}
      brand={kit}
      editing={false}
      onEditing={() => {}}
      onEdit={() => {}}
      onUseGuided={() => {}}
      onBackTo={() => {}}
      {...overrides}
    />,
  );

describe('the preview', () => {
  it('is the real control, with the person’s own words — and the one sentence under it', () => {
    const html = preview(atPlacement());
    expect(html).toContain('Which day suits you?');
    // The same choice markup the public form draws (`FieldInput`), styled as the answers made it.
    expect(html).toMatch(/class="choice choice--buttons choice--shape-pill/);
    expect(html).toContain(en('conversation.preview.edit'));
  });

  it('says so when the organisation has no brand kit, rather than pretending it has one', () => {
    expect(preview(atPlacement(), { brand: { ...kit, customised: false } })).toContain(
      en('conversation.preview.noBrand'),
    );
    expect(preview(atPlacement())).not.toContain(en('conversation.preview.noBrand'));
  });

  it('lists what Loppa assumed, newest first, each a way back', () => {
    const html = preview(atPlacement());
    expect(html).toContain(en('conversation.preview.assumed'));
    const shape = html.indexOf(en('guided.choice.shape.pill'));
    const count = html.indexOf(en('guided.choice.count.ask'));
    expect(shape).toBeGreaterThan(-1);
    expect(count).toBeGreaterThan(shape);
  });

  it('wears the badge and the way back once the question is changed by hand', () => {
    const c = atPlacement();
    expect(preview(c)).not.toContain(en('conversation.byHand'));
    const id = c.state.focus!;
    const edited = edit(
      c,
      [{ op: 'set', path: `draft.definition.fields[id=${id}].style.size`, value: 'large' }],
      { locale },
    );
    const html = preview(edited);
    expect(html).toContain(en('conversation.byHand'));
    expect(html).toContain(en('conversation.revert'));
  });

  it('shows the whole form under the organisation’s logo in its slot, on a masthead preview', () => {
    const c = atPlacement();
    const placed = edit(
      c,
      [{ op: 'set', path: 'draft.definition.settings.layout.logoSlot', value: 'masthead-centred' }],
      { locale },
    );
    const html = preview(placed, { spec: 'brand.masthead' });
    expect(html).toContain('masthead--masthead-centred');
    expect(html).toContain('Demo AB');
  });
});

describe('inline editing', () => {
  const open = () => preview(atPlacement(), { editing: true });

  it('offers the named shapes, the current one pressed', () => {
    const html = open();
    for (const shape of ['pill', 'rounded', 'square', 'tab', 'segmented', 'tile']) {
      expect(html).toContain(`inline-edit__sample--${shape}`);
    }
    expect(html).toMatch(
      /aria-pressed="true"[^>]*><span class="inline-edit__sample inline-edit__sample--pill"/,
    );
  });

  it('has a size handle that cannot go under the smallest size', () => {
    const html = open();
    expect(html).toMatch(new RegExp(`aria-label="${en('conversation.edit.smaller')}" disabled=""`));
    expect(html).not.toMatch(
      new RegExp(`aria-label="${en('conversation.edit.larger')}" disabled=""`),
    );
  });

  it('colours by brand role, three swatches and no colour picker', () => {
    const html = open();
    expect(html.match(/inline-edit__chip--/g)).toHaveLength(3);
    expect(html).not.toContain('type="color"');
  });

  it('renames in place, and moves answers by drag or by Move up / Move down', () => {
    const html = open();
    expect(html.match(/class="inline-edit__answer"/g)).toHaveLength(3);
    expect(
      html.match(new RegExp(`aria-label="${en('conversation.edit.drag')}"`, 'g')),
    ).toHaveLength(3);
    // The first cannot go up, the last cannot go down.
    expect(html).toMatch(new RegExp(`aria-label="${en('conversation.edit.moveUp')}" disabled=""`));
    expect(html).toMatch(
      new RegExp(`aria-label="${en('conversation.edit.moveDown')}" disabled=""`),
    );
  });
});

describe('a question to reconcile', () => {
  it('is asked before anything else, with its three answers and the person’s version shown', () => {
    const c = atPlacement();
    const id = c.state.focus!;
    const edited = edit(
      c,
      [{ op: 'set', path: `draft.definition.fields[id=${id}].style.size`, value: 'large' }],
      { locale },
    );
    // "Under the question, full width": the conversation would change the question — it proposes.
    const waiting = answer(G, edited, { kind: 'option', optionId: 'under-full' }, { locale });
    const html = renderToStaticMarkup(
      <Shell
        graph={G}
        conversation={waiting}
        onChange={() => {}}
        locales={{ interfaceLocale: locale, contentLocale: locale }}
        contentLocales={organisation}
        desktop={false}
        onOpenEditor={() => {}}
        brand={kit}
      />,
    );
    expect(html).toContain(`>${en('conversation.reconcile.ask')}</h1>`);
    for (const key of ['mine', 'guided', 'both']) {
      expect(html).toContain(en(`conversation.reconcile.${key}`));
    }
    expect(html).toContain(en('conversation.reconcile.yours'));
    expect(html).not.toContain('conversation__type');
  });
});
