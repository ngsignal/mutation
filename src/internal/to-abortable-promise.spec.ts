import { Observable, Subject, of } from 'rxjs';
import { isObserved } from '../testing/rxjs';
import { toAbortablePromise } from './to-abortable-promise';

describe('toAbortablePromise', () => {
  it('rejects with AbortError without subscribing when the signal is already aborted', async () => {
    const subject = new Subject<string>();
    const controller = new AbortController();
    controller.abort();

    await expect(toAbortablePromise(subject, controller.signal, 'empty')).rejects.toMatchObject({ name: 'AbortError' });
    expect(isObserved(subject)).toBe(false);
  });

  it('rejects with the abort reason and unsubscribes when the signal aborts mid-flight', async () => {
    const subject = new Subject<string>();
    const controller = new AbortController();
    const reason = new Error('custom reason');

    const promise = toAbortablePromise(subject, controller.signal, 'empty');
    expect(isObserved(subject)).toBe(true);
    controller.abort(reason);

    await expect(promise).rejects.toBe(reason);
    expect(isObserved(subject)).toBe(false);
  });

  it('resolves with the last value, once the source completes', async () => {
    await expect(toAbortablePromise(of('a', 'b', 'c'), new AbortController().signal, 'empty')).resolves.toBe('c');
  });

  it('keeps the abort outcome when a synchronous source aborts, then completes, while subscribing', async () => {
    const controller = new AbortController();
    const reason = new Error('aborted on subscribe');
    const source = new Observable<string>((subscriber) => {
      controller.abort(reason);
      subscriber.next('late');
      subscriber.complete();
    });

    await expect(toAbortablePromise(source, controller.signal, 'empty')).rejects.toBe(reason);
  });
});
