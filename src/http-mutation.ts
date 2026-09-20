import {
  HttpClient,
  HttpErrorResponse,
  HttpEventType,
  type HttpEvent,
  type HttpHeaders,
  type HttpProgressEvent,
  type HttpResourceRequest,
} from '@angular/common/http';
import { Injector, assertInInjectionContext, inject, signal, type Signal } from '@angular/core';
import { Observable } from 'rxjs';
import { toAbortablePromise } from './internal/to-abortable-promise.js';
import { mutation } from './mutation.js';
import type { MutationOptions, MutationRef } from './mutation.types.js';

/**
 * Same shape as `httpResource()`'s request, reused so it can't drift from what Angular accepts,
 * except `method` is required (no silent GET default for a mutation) and there's no
 * `transferCache` (SSR transfer cache only applies to reads).
 */
export type HttpMutationRequest = Omit<HttpResourceRequest, 'method' | 'transferCache'> & {
  // `string & {}` keeps autocompletion for the common methods while still accepting any string.
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' | (string & {});
};

export interface HttpMutationOptions<TInput, TOutput, TError = unknown>
  extends Omit<MutationOptions<TInput, TOutput, TError>, 'mutationFn'> {
  /** Describe the request for a given input, e.g. `(user) => ({ method: 'POST', url: '/api/users', body: user })`. */
  request: (input: TInput) => HttpMutationRequest;
}

export interface HttpMutationRef<TInput, TOutput, TValue = TOutput | undefined, TError = unknown>
  extends MutationRef<TInput, TOutput, TValue, TError> {
  readonly progress: Signal<HttpProgressEvent | undefined>;
  readonly statusCode: Signal<number | undefined>;
  readonly headers: Signal<HttpHeaders | undefined>;
  hasValue(): this is HttpMutationRef<TInput, TOutput, TOutput, TError>;
}

function isProgressEvent<T>(event: HttpEvent<T>): event is HttpProgressEvent {
  return event.type === HttpEventType.UploadProgress || event.type === HttpEventType.DownloadProgress;
}

/** The `progress`/`statusCode`/`headers` signals, and how HTTP events and errors feed them. */
function createHttpResponseState() {
  const progress = signal<HttpProgressEvent | undefined>(undefined);
  const statusCode = signal<number | undefined>(undefined);
  const headers = signal<HttpHeaders | undefined>(undefined);

  return {
    signals: {
      progress: progress.asReadonly(),
      statusCode: statusCode.asReadonly(),
      headers: headers.asReadonly(),
    },
    clear(): void {
      progress.set(undefined);
      statusCode.set(undefined);
      headers.set(undefined);
    },
    recordEvent(event: HttpEvent<unknown>): void {
      if (isProgressEvent(event)) {
        progress.set(event);
      } else if (event.type === HttpEventType.Response) {
        statusCode.set(event.status);
        headers.set(event.headers);
      }
    },
    recordError(error: unknown): void {
      if (error instanceof HttpErrorResponse) {
        statusCode.set(error.status);
        headers.set(error.headers);
      }
    },
  };
}

type HttpResponseState = ReturnType<typeof createHttpResponseState>;

/**
 * The response body of `events$`, recording each event into `responseState` while `isCurrent()`.
 * Plain subscription instead of tap/filter/map: root-level operators need RxJS >= 7.2.
 */
function recordedResponseBody<TOutput>(
  events$: Observable<HttpEvent<TOutput>>,
  responseState: HttpResponseState,
  isCurrent: () => boolean,
): Observable<TOutput> {
  return new Observable<TOutput>((subscriber) => {
    // Like tap(): an exception while recording errors the stream. Thrown from a subscribe
    // callback, RxJS would only report it globally and the call could never settle.
    const tryRecord = (write: () => void): boolean => {
      try {
        if (isCurrent()) write();
        return true;
      } catch (recordingError) {
        subscriber.error(recordingError);
        return false;
      }
    };
    return events$.subscribe({
      next: (event) => {
        if (tryRecord(() => responseState.recordEvent(event)) && event.type === HttpEventType.Response) {
          subscriber.next(event.body as TOutput);
        }
      },
      error: (error: unknown) => {
        if (tryRecord(() => responseState.recordError(error))) subscriber.error(error);
      },
      complete: () => subscriber.complete(),
    });
  });
}

/**
 * The only `HttpResourceRequest` fields whose typings are looser than `HttpClient`'s: readonly
 * header arrays and `string & {}` for the fetch enums. HttpClient forwards them unchanged.
 */
type LooselyTypedField = 'headers' | 'cache' | 'credentials' | 'priority' | 'mode' | 'redirect' | 'referrerPolicy';

interface HttpClientLooselyTypedFields {
  headers?: HttpHeaders | Record<string, string | string[]>;
  cache?: RequestCache;
  credentials?: RequestCredentials;
  priority?: RequestPriority;
  mode?: RequestMode;
  redirect?: RequestRedirect;
  referrerPolicy?: ReferrerPolicy;
}

function sendRequest<TOutput>(http: HttpClient, { method, url, ...requestOptions }: HttpMutationRequest) {
  // Every other field is type-checked against HttpClient's options: only the fields above are cast.
  const checkedOptions: Omit<typeof requestOptions, LooselyTypedField> = requestOptions;
  return http.request<TOutput>(method, url, {
    ...checkedOptions,
    ...(requestOptions as HttpClientLooselyTypedFields),
    observe: 'events',
    responseType: 'json',
  });
}

/**
 * `mutation()` for `HttpClient` requests described as data, the mutation counterpart of
 * `httpResource()`: it sends the request itself with `observe: 'events'`, so `progress`,
 * `statusCode` and `headers` are always available. To reuse an existing Observable-returning
 * service instead, see `rxMutation()`.
 */
export function httpMutation<TInput, TOutput, TError = unknown>(
  options: HttpMutationOptions<TInput, TOutput, TError>,
): HttpMutationRef<TInput, TOutput, TOutput | undefined, TError> {
  if (!options.injector) {
    assertInInjectionContext(httpMutation);
  }
  const { request, ...mutationOptions } = options;
  const injector = options.injector ?? inject(Injector);
  const http = injector.get(HttpClient);
  const responseState = createHttpResponseState();
  let generation = 0;

  const mutationRef = mutation<TInput, TOutput, TError>({
    ...mutationOptions,
    injector,
    mutationFn: (input, abortSignal) => {
      const currentGeneration = ++generation;
      // Same stale-response guarding mutation() applies to value/status/error: ignore events
      // from a call superseded by a more recent mutate().
      const isCurrent = () => currentGeneration === generation;
      responseState.clear();

      const body$ = recordedResponseBody(sendRequest<TOutput>(http, request(input)), responseState, isCurrent);
      return toAbortablePromise(body$, abortSignal, 'Request completed without an HttpResponse event');
    },
  });

  // hasValue() is a type guard hard-wired to MutationRef: re-declared so it narrows to
  // HttpMutationRef (the spread copy would not type-check, and would narrow `value` to never).
  return {
    ...mutationRef,
    ...responseState.signals,
    reset(): void {
      // mutationRef.reset() aborts in-flight calls, so no event can land after this clears.
      mutationRef.reset();
      responseState.clear();
    },
    hasValue(): this is HttpMutationRef<TInput, TOutput, TOutput, TError> {
      return mutationRef.hasValue();
    },
  };
}
