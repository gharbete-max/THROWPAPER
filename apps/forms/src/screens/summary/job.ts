import { useCallback, useEffect, useRef, useState } from 'react';
import type { JobStep, JobWarning, ModelBridge, ModelJob, ModelProblem } from '@tp/shared/summary';

/**
 * One job at a time through the desktop's bridge, as React state.
 *
 * The text sent and the text received live in this hook's caller and nowhere else: not in
 * storage, not in the URL, not in a request. The bridge is the shell on this computer
 * (`lib/model-bridge.ts`); this file imports no API client (`bundle-split.test.ts`).
 */
export interface JobState {
  phase: 'idle' | 'running' | 'done' | 'failed';
  text: string;
  step: { step: JobStep; done: number; total: number } | null;
  warnings: JobWarning[];
  selected: number[] | null;
  problem: ModelProblem | null;
  seconds: number | null;
}

export const IDLE: JobState = {
  phase: 'idle',
  text: '',
  step: null,
  warnings: [],
  selected: null,
  problem: null,
  seconds: null,
};

export function useJob(bridge: ModelBridge) {
  const [state, setState] = useState<JobState>(IDLE);
  const current = useRef<string | null>(null);

  useEffect(
    () =>
      bridge.onEvent((event) => {
        if (event.id !== current.current) return;
        setState((s) => {
          switch (event.kind) {
            case 'step':
              return { ...s, step: { step: event.step, done: event.done, total: event.total } };
            case 'text':
              return { ...s, text: event.mode === 'replace' ? event.text : s.text + event.text };
            case 'selected':
              return { ...s, selected: event.numbers };
            case 'done':
              return {
                ...s,
                phase: 'done',
                warnings: event.warnings,
                seconds: event.seconds,
                step: null,
              };
            case 'error':
              return { ...s, phase: 'failed', problem: event.problem, step: null };
            default:
              return s;
          }
        });
        if (event.kind === 'done' || event.kind === 'error') current.current = null;
      }),
    [bridge],
  );

  const start = useCallback(
    async (job: ModelJob) => {
      const id = crypto.randomUUID();
      current.current = id;
      setState({ ...IDLE, phase: 'running' });
      const result = await bridge.start(id, job);
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
