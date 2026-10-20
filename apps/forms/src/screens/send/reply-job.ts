import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiBridge, AiEvent, AiProblem, TextTask } from '@tp/shared/ai';
import type { JobStep, JobWarning } from '@tp/shared/summary';

/**
 * One text task at a time (a reply, a proofreading, an email) through the desktop's `window.loppaAi`, as React state.
 *
 * The received message and the draft live in the component that owns them and nowhere else: not in
 * storage, not in the URL, not in a request. The bridge is the shell on this computer
 * (`lib/ai-bridge.ts`); this file imports no API client (`bundle-split.test.ts`).
 */
export interface ReplyState {
  phase: 'idle' | 'running' | 'done' | 'failed';
  text: string;
  step: { step: JobStep; done: number; total: number } | null;
  warnings: JobWarning[];
  problem: AiProblem | null;
}

export const IDLE: ReplyState = {
  phase: 'idle',
  text: '',
  step: null,
  warnings: [],
  problem: null,
};

/** A state after an event of the task it belongs to. Pure, so it can be tested without a window. */
export function applyEvent(state: ReplyState, event: AiEvent): ReplyState {
  switch (event.kind) {
    case 'step':
      return { ...state, step: { step: event.step, done: event.done, total: event.total } };
    case 'text':
      return { ...state, text: event.mode === 'replace' ? event.text : state.text + event.text };
    case 'done':
      return { ...state, phase: 'done', warnings: event.warnings, step: null };
    case 'error':
      return { ...state, phase: 'failed', problem: event.problem, step: null };
    default:
      return state;
  }
}

export function useReplyJob(bridge: AiBridge) {
  const [state, setState] = useState<ReplyState>(IDLE);
  const current = useRef<string | null>(null);

  useEffect(
    () =>
      bridge.onEvent((event) => {
        if (event.id !== current.current) return;
        setState((s) => applyEvent(s, event));
        if (event.kind === 'done' || event.kind === 'error') current.current = null;
      }),
    [bridge],
  );

  // Leaving the panel stops what is running: nothing is left writing for a screen that is gone.
  useEffect(
    () => () => {
      if (current.current) void bridge.cancel(current.current);
    },
    [bridge],
  );

  const start = useCallback(
    async (task: TextTask) => {
      const id = crypto.randomUUID();
      current.current = id;
      setState({ ...IDLE, phase: 'running' });
      const result = await bridge.run(id, task);
      if (!result.ok) {
        current.current = null;
        setState({ ...IDLE, phase: 'failed', problem: result.problem });
      }
    },
    [bridge],
  );

  const cancel = useCallback(() => {
    if (current.current) void bridge.cancel(current.current);
  }, [bridge]);

  const reset = useCallback(() => setState(IDLE), []);

  return { state, start, cancel, reset };
}
