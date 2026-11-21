import { signal, type PendingTasks } from '@angular/core';

/** A `mutate()` admitted by the concurrency gate. */
export interface Call<TInput> {
  readonly input: TInput;
  readonly abortSignal: AbortSignal;
  finish(): void;
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
        finish(): void {
          removeTask();
          activeCalls.delete(call);
          publishInputs();
        },
      };
      activeCalls.set(call, { controller, removeTask });
      latest = call;
      publishInputs();
      return call;
    },
    isLatest: (call: Call<TInput>) => call === latest,
    abortAll(): void {
      for (const { controller, removeTask } of activeCalls.values()) {
        controller.abort(new DOMException('Aborted', 'AbortError'));
        removeTask();
      }
      activeCalls.clear();
      latest = undefined;
      pendingInputs.set([]);
    },
  };
}
