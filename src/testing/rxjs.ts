import { Observable, type Subject } from 'rxjs';

// Spec helpers that behave the same on RxJS 6 and 7: the CI runs the suite on both.

/** An Observable that errors with `error` on subscribe (`throwError(() => error)` is RxJS 7+). */
export function failWith(error: unknown): Observable<never> {
  return new Observable<never>((subscriber) => subscriber.error(error));
}

/** Whether `subject` has subscribers (`observed` is RxJS 7+, `observers` is deprecated there). */
export function isObserved<T>(subject: Subject<T>): boolean {
  const { observed } = subject as { observed?: boolean };
  return observed ?? subject.observers.length > 0;
}
