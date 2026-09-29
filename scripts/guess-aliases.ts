/**
 * Writes the built-in aliases of the guess questions (S11, `docs/plan/BELIEF.md`): every one is a
 * yes / no / "not sure" question, so each language's ways of saying those three are written once
 * here and given to every question of group `guess`. The entries land in
 * `packages/shared/src/interpret/aliases/<language>.json` in canonical order, like every built-in
 * alias; `pnpm builder:validate` checks them against the graph. Run it again after adding a guess
 * question: `pnpm tsx scripts/guess-aliases.ts`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { BUILDER_GRAPH } from '../packages/shared/src/builder/graph/nodes.js';
import {
  AliasFile,
  formatAliasFile,
  sortEntries,
  type AliasEntry,
} from '../packages/shared/src/interpret/aliases.js';
import type { Language } from '../packages/shared/src/interpret/lexicon.js';

/** The card's own label first, then other ways of saying it. */
const WAYS: Record<Language, { yes: string[]; no: string[]; unsure: string[] }> = {
  en: {
    yes: ['Yes', 'yeah', 'yep', 'correct', 'exactly'],
    no: ['No', 'nope', 'not really', 'not at all'],
    unsure: ['Not sure', "don't know", 'maybe', 'unsure', 'no idea'],
  },
  sv: {
    yes: ['Ja', 'japp', 'absolut', 'det stämmer', 'stämmer'],
    no: ['Nej', 'nä', 'nix', 'inte alls'],
    unsure: ['Vet inte', 'osäker', 'kanske', 'ingen aning', 'vet ej'],
  },
  da: {
    yes: ['Ja', 'jep', 'absolut', 'det passer', 'korrekt'],
    no: ['Nej', 'næ', 'nix', 'slet ikke'],
    unsure: ['Ved ikke', 'usikker', 'måske', 'aner det ikke', 'ingen anelse'],
  },
  nb: {
    yes: ['Ja', 'jepp', 'absolutt', 'det stemmer', 'stemmer'],
    no: ['Nei', 'næ', 'nix', 'slett ikke'],
    unsure: ['Vet ikke', 'usikker', 'kanskje', 'aner ikke', 'ingen anelse'],
  },
  fi: {
    yes: ['Kyllä', 'joo', 'juu', 'pitää paikkansa', 'totta'],
    no: ['Ei', 'ei ole', 'eipä', 'ei todellakaan'],
    unsure: ['En tiedä', 'epävarma', 'ehkä', 'en ole varma', 'en osaa sanoa'],
  },
  is: {
    yes: ['Já', 'jú', 'rétt', 'það passar', 'einmitt'],
    no: ['Nei', 'alls ekki', 'neibb'],
    unsure: ['Veit ekki', 'óviss', 'kannski', 'ég veit ekki', 'hef ekki hugmynd'],
  },
  fr: {
    yes: ['Oui', 'ouais', 'exact', 'tout à fait', 'c’est ça'],
    no: ['Non', 'pas vraiment', 'pas du tout', 'nan'],
    unsure: ['Je ne sais pas', 'pas sûr', 'peut-être', 'aucune idée', 'je sais pas'],
  },
  de: {
    yes: ['Ja', 'genau', 'stimmt', 'richtig', 'jawohl'],
    no: ['Nein', 'nee', 'eher nicht', 'gar nicht'],
    unsure: ['Weiß nicht', 'unsicher', 'vielleicht', 'keine Ahnung'],
  },
  es: {
    yes: ['Sí', 'claro', 'correcto', 'exacto', 'efectivamente'],
    no: ['No', 'para nada', 'nop', 'en absoluto'],
    unsure: ['No lo sé', 'no sé', 'quizás', 'tal vez', 'ni idea'],
  },
  zh: {
    yes: ['是', '是的', '对', '对的', '没错'],
    no: ['否', '不是', '不对', '没有'],
    unsure: ['不确定', '不知道', '说不准', '也许', '不清楚'],
  },
  ja: {
    yes: ['はい', 'そうです', 'うん', 'ええ', 'その通り'],
    no: ['いいえ', 'いや', 'ちがう', '違います'],
    unsure: ['わからない', '分からない', 'たぶん', '不明', '知らない'],
  },
  ru: {
    yes: ['Да', 'ага', 'верно', 'именно', 'конечно'],
    no: ['Нет', 'неа', 'не совсем', 'вовсе нет'],
    unsure: ['Не знаю', 'не уверен', 'может быть', 'возможно', 'не уверена'],
  },
};

const guessNodes = BUILDER_GRAPH.nodes.filter(
  (node) => node.group === 'guess' && node.kind === 'question',
);

for (const [language, ways] of Object.entries(WAYS) as [Language, (typeof WAYS)[Language]][]) {
  const path = new URL(
    `../packages/shared/src/interpret/aliases/${language}.json`,
    import.meta.url,
  );
  const file = AliasFile.parse(JSON.parse(readFileSync(path, 'utf8')));
  const kept = file.entries.filter((entry) => !guessNodes.some((n) => n.id === entry.nodeId));
  const added: AliasEntry[] = [];
  for (const node of guessNodes) {
    for (const optionId of ['yes', 'no', 'unsure'] as const) {
      ways[optionId].forEach((phrase, index) => {
        added.push({
          phrase,
          nodeId: node.id,
          optionId,
          locale: language,
          source: 'built-in',
          createdAt: '2026-09-29',
          count: 0,
          notes: index === 0 ? "the card's label" : 'shared by every guess question',
        });
      });
    }
  }
  writeFileSync(path, formatAliasFile({ ...file, entries: sortEntries([...kept, ...added]) }));
}
console.log(
  `guess aliases written: ${guessNodes.length} questions, ${Object.keys(WAYS).length} languages`,
);
