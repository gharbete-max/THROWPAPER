import { useCallback, useRef, useState } from 'react';
import type { FormDefinition } from '@tp/shared/forms';
import { createHistory } from './history.js';

/**
 * `createHistory` with the two flags the buttons need mirrored into state.
 *
 * The stacks stay in a ref so recording never has to wait for a render to land; only "is there
 * anything to undo" is state, because only that is drawn.
 */
export function useHistory() {
  const history = useRef(createHistory()).current;
  const [flags, setFlags] = useState({ canUndo: false, canRedo: false });

  const sync = useCallback(
    () => setFlags({ canUndo: history.canUndo(), canRedo: history.canRedo() }),
    [history],
  );

  return {
    canUndo: flags.canUndo,
    canRedo: flags.canRedo,
    record: useCallback(
      (previous: FormDefinition, next: FormDefinition) => {
        history.record(previous, next);
        sync();
      },
      [history, sync],
    ),
    undo: useCallback(
      (current: FormDefinition) => {
        const target = history.undo(current);
        sync();
        return target;
      },
      [history, sync],
    ),
    redo: useCallback(
      (current: FormDefinition) => {
        const target = history.redo(current);
        sync();
        return target;
      },
      [history, sync],
    ),
    reset: useCallback(() => {
      history.reset();
      sync();
    }, [history, sync]),
  };
}
