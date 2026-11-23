import { signal, type PendingTasks } from '@angular/core';
import { abortError } from './abort-error.js';

/** A `mutate()` admitted by the concurrency gate. */
export interface Call<TInput> {
  readonly input: TInput;
  readonly abortSignal: AbortSignal;
  /**
   * Takes the settled call out of `pendingInputs()` and out of `abortAll()`'s reach, runs `commit`,
   * then releases its pending task: a call that `commit` starts keeps the app unstable.
   */
  finish(commit: () => void): void;
}

/** A newer call, `reset()` or destroy makes a call no longer the latest; only `reset()` and destroy abort it. */
export function createCallTracker<TInput>(pendingTasks: PendingTasks, signalOptions?: { debugName: string }) {
  const activeCalls = new Map<Call<TInput>, { controller: AbortController; removeTask: () => void }>();
  let latest: Call<TInput> | undefined;
  const pendingInputs = signal<readonly TInput[]>([], signalOptions);
  const publishInputs = () => pendingInputs.set(Array.from(activeCalls.keys(), (call) => call.input));
  return {
    pendingInputs: pendingInputs.asReadonly(),
    start(input: TInput): Call<TInput> {
      const controller = new AbortController();
      const removeTask = pendingTasks.add();
      const call: Call<TInput> = {
        input,
        abortSignal: controller.signal,
        finish(commit): void {
          if (activeCalls.delete(call)) {
            publishInputs();
          }
          try {
            commit();
          } finally {
            removeTask();
          }
        },
      };
      activeCalls.set(call, { controller, removeTask });
      latest = call;
      publishInputs();
      return call;
    },
    isLatest: (call: Call<TInput>) => call === latest,
    abortAll(): void {
      latest = undefined;
      if (activeCalls.size === 0) {
        return;
      }
      // Forgotten before aborting: a call an abort listener starts is a new call, not one to abort.
      const aborted = Array.from(activeCalls.values());
      activeCalls.clear();
      pendingInputs.set([]);
      for (const { controller, removeTask } of aborted) {
        controller.abort(abortError('Aborted'));
        removeTask();
      }
    },
  };
}
