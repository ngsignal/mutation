import { Subject } from 'rxjs';
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
});
