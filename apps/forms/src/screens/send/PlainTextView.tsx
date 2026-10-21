import { useT } from '../../lib/i18n.js';
import { foldText, linksIn } from '../../lib/plain-text.js';

/**
 * One recipient's campaign message as a text-only mail program shows it (the message is plain
 * text; there is no other version), and the links found in it. The links are listed as written:
 * none is tracked or rewritten.
 */
export function PlainTextView({ text }: { text: string }) {
  const t = useT();
  const links = linksIn(text);
  return (
    <div className="stack stack--tight" data-testid="campaign-plain">
      <h3>{t('campaign.plainText')}</h3>
      <p className="small muted">{t('campaign.plainTextHint')}</p>
      <pre className="plain">{foldText(text)}</pre>
      <h3>{t('campaign.links')}</h3>
      {links.length === 0 ? (
        <p className="small">{t('campaign.links.none')}</p>
      ) : (
        <ul className="small" data-testid="campaign-links">
          {links.map((link) => (
            <li key={link} className="outgoing__text">
              {link}
            </li>
          ))}
        </ul>
      )}
      <p className="small muted">{t('campaign.links.note')}</p>
    </div>
  );
}
