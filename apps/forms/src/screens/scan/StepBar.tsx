import { useT } from '../../lib/i18n.js';

export const STEPS = ['bring', 'fix', 'keep'] as const;
export type Step = (typeof STEPS)[number];

/**
 * Where Scan is in its three steps: bring in, fix, keep or pass on. Real buttons, so the way back
 * is always one press (Tab, Enter) away; the later steps wait until there are pages to work on.
 * The tabs already used for the piles do the drawing.
 */
export function StepBar({
  step,
  hasPages,
  onStep,
}: {
  step: Step;
  hasPages: boolean;
  onStep: (step: Step) => void;
}) {
  const t = useT();
  return (
    <nav className="tabs scan__steps" aria-label={t('scan.steps')}>
      {STEPS.map((name, at) => (
        <button
          key={name}
          type="button"
          className={name === step ? 'tab tab--current' : 'tab'}
          aria-current={name === step ? 'step' : undefined}
          disabled={name !== 'bring' && !hasPages}
          onClick={() => onStep(name)}
        >
          {at + 1}. {t(`scan.step.${name}`)}
        </button>
      ))}
    </nav>
  );
}
