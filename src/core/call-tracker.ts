import { signal, type DestroyRef, type PendingTasks } from '@angular/core';
import { abortedError } from './abort-error.js';

/** A `mutate()` admitted by the concurrency gate. */
export interface Call<TInput> {
  readonly input: TInput;
  readonly abortSignal: AbortSignal;
  /**
   * Takes the settled call out of `pendingInputs()` and out of `abortAll()`'s reach, runs `commit`,
   * then releases its pending task: a call that `commit` starts keeps the app unstable.
   */
  finish(commit: () => void): void;
  /** Aborts this call alone: it leaves `pendingInputs()` and releases its task at once. Never the latest call. */
  abort(reason: unknown): void;
}

/**
 * A newer call, `reset()` or destroy makes a call no longer the latest; only `reset()` and destroy
 * abort it, or `Call.abort()`. Destroy is only listened to while calls are in flight: an idle mutation leaves nothing
 * behind in a long-lived injector.
 */
export function createCallTracker<TInput>(
  pendingTasks: PendingTasks,
  destroyRef: DestroyRef,
  signalOptions?: { debugName: string },
) {
  const activeCalls = new Map<Call<TInput>, { controller: AbortController; removeTask: () => void }>();
  let latest: Call<TInput> | undefined;
  let stopListeningToDestroy: (() => void) | undefined;
  const pendingInputs = signal<readonly TInput[]>([], signalOptions);
  const publishInputs = () => pendingInputs.set(Array.from(activeCalls.keys(), (call) => call.input));

  function onActiveCallsChanged(): void {
    publishInputs();
    if (activeCalls.size === 0) {
      stopListeningToDestroy?.();
      stopListeningToDestroy = undefined;
    } else {
      stopListeningToDestroy ??= destroyRef.onDestroy(abortAll);
    }
  }

  function abortAll(): void {
    latest = undefined;
    if (activeCalls.size === 0) {
      return;
    }
    // Forgotten before aborting: a call an abort listener starts is a new call, not one to abort.
    const aborted = Array.from(activeCalls.values());
    activeCalls.clear();
    onActiveCallsChanged();
    for (const { controller, removeTask } of aborted) {
      controller.abort(abortedError());
      removeTask();
    }
  }

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
            onActiveCallsChanged();
          }
          try {
            commit();
          } finally {
            removeTask();
          }
        },
        abort(reason): void {
          // Forgotten before aborting, like abortAll().
          activeCalls.delete(call);
          onActiveCallsChanged();
          controller.abort(reason);
          removeTask();
        },
      };
      activeCalls.set(call, { controller, removeTask });
      latest = call;
      onActiveCallsChanged();
      return call;
    },
    isLatest: (call: Call<TInput>) => call === latest,
    abortAll,
  };
}
