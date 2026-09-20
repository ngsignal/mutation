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
import { filter, map, tap } from 'rxjs/operators';
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

export interface HttpMutationOptions<TInput, TOutput, TError = unknown, TRaw = unknown>
  extends Omit<MutationOptions<TInput, TOutput, TError>, 'mutationFn'> {
  /** Describe the request for a given input, e.g. `(user) => ({ method: 'POST', url: '/api/users', body: user })`. */
  request: (input: TInput) => HttpMutationRequest;
  /**
   * Transform or validate the response body before it resolves the call (e.g. a schema's `parse`).
   * If it throws, the call fails with that error, although the server has already applied the write.
   */
  parse?: (raw: TRaw) => TOutput;
}

/** Options of the non-JSON variants: `parse` becomes required when `TOutput` isn't the raw body type. */
export type HttpMutationRawBodyOptions<TInput, TOutput, TError, TRaw> =
  HttpMutationOptions<TInput, TOutput, TError, TRaw> &
  ([TRaw] extends [TOutput] ? unknown : { parse: (raw: TRaw) => TOutput });

export interface HttpMutationRef<TInput, TOutput, TValue = TOutput | undefined, TError = unknown>
  extends MutationRef<TInput, TOutput, TValue, TError> {
  /** Needs `reportProgress: true`, and `withXhr()` on Angular 22+ (`fetch` ignores it silently). */
  readonly uploadProgress: Signal<HttpProgressEvent | undefined>;
  /** Needs `reportProgress: true`. */
  readonly downloadProgress: Signal<HttpProgressEvent | undefined>;
  readonly statusCode: Signal<number | undefined>;
  readonly headers: Signal<HttpHeaders | undefined>;
  hasValue(): this is HttpMutationRef<TInput, TOutput, TOutput, TError>;
}

function createHttpResponseState() {
  const uploadProgress = signal<HttpProgressEvent | undefined>(undefined);
  const downloadProgress = signal<HttpProgressEvent | undefined>(undefined);
  const statusCode = signal<number | undefined>(undefined);
  const headers = signal<HttpHeaders | undefined>(undefined);
  let generation = 0;

  function clear(): void {
    uploadProgress.set(undefined);
    downloadProgress.set(undefined);
    statusCode.set(undefined);
    headers.set(undefined);
  }

  function recordEvent(event: HttpEvent<unknown>): void {
    switch (event.type) {
      case HttpEventType.UploadProgress:
        uploadProgress.set(event);
        break;
      case HttpEventType.DownloadProgress:
        downloadProgress.set(event);
        break;
      case HttpEventType.Response:
        statusCode.set(event.status);
        headers.set(event.headers);
        break;
    }
  }

  function recordError(error: unknown): void {
    if (error instanceof HttpErrorResponse) {
      statusCode.set(error.status);
      headers.set(error.headers);
    }
  }

  return {
    signals: {
      uploadProgress: uploadProgress.asReadonly(),
      downloadProgress: downloadProgress.asReadonly(),
      statusCode: statusCode.asReadonly(),
      headers: headers.asReadonly(),
    },
    clear,
    /** Clears the signals for a new call, and returns recorders that go silent once it's superseded. */
    startCall() {
      const callGeneration = ++generation;
      const isCurrent = () => callGeneration === generation;
      clear();
      return {
        recordEvent: (event: HttpEvent<unknown>) => {
          if (isCurrent()) recordEvent(event);
        },
        recordError: (error: unknown) => {
          if (isCurrent()) recordError(error);
        },
      };
    },
  };
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

type ResponseType = 'json' | 'text' | 'blob' | 'arraybuffer';

function sendRequest(
  http: HttpClient,
  { method, url, ...requestOptions }: HttpMutationRequest,
  responseType: ResponseType,
) {
  // Only the fields above are cast: every other field is still type-checked by http.request().
  const options = requestOptions as Omit<typeof requestOptions, LooselyTypedField> & HttpClientLooselyTypedFields;
  return http.request<unknown>(method, url, {
    ...options,
    observe: 'events',
    // Typed as 'json' to pick the `HttpEvent<unknown>` overload: each variant's signature types the body.
    responseType: responseType as 'json',
  });
}

type HttpMutationRawBodyFn<TRaw> = <TInput, TOutput = TRaw, TError = unknown>(
  options: HttpMutationRawBodyOptions<TInput, TOutput, TError, TRaw>,
) => HttpMutationRef<TInput, TOutput, TOutput | undefined, TError>;

export interface HttpMutationFn {
  <TInput, TOutput, TError = unknown>(
    options: HttpMutationOptions<TInput, TOutput, TError>,
  ): HttpMutationRef<TInput, TOutput, TOutput | undefined, TError>;
  /** Same as `httpMutation()`, with the response body read as a `string`. */
  text: HttpMutationRawBodyFn<string>;
  /** Same as `httpMutation()`, with the response body read as a `Blob` (e.g. a generated file). */
  blob: HttpMutationRawBodyFn<Blob>;
  /** Same as `httpMutation()`, with the response body read as an `ArrayBuffer`. */
  arrayBuffer: HttpMutationRawBodyFn<ArrayBuffer>;
}

function makeHttpMutationFn(responseType: ResponseType) {
  // Named so that injection-context errors mention `httpMutation`, for every variant. `never`: each
  // public signature narrows `parse`'s raw body type, which the body satisfies at runtime.
  return function httpMutation<TInput, TOutput, TError>(
    options: HttpMutationOptions<TInput, TOutput, TError, never>,
  ): HttpMutationRef<TInput, TOutput, TOutput | undefined, TError> {
    if (!options.injector) {
      assertInInjectionContext(httpMutation);
    }
    const { request, parse, ...mutationOptions } = options;
    const injector = options.injector ?? inject(Injector);
    const http = injector.get(HttpClient);
    const responseState = createHttpResponseState();

    const mutationRef = mutation<TInput, TOutput, TError>({
      ...mutationOptions,
      injector,
      mutationFn: (input, abortSignal) => {
        const call = responseState.startCall();
        const body$ = sendRequest(http, request(input), responseType).pipe(
          tap({ next: call.recordEvent, error: call.recordError }),
          filter((event) => event.type === HttpEventType.Response),
          map((response) => (parse ? parse(response.body as never) : (response.body as TOutput))),
        );
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
  };
}

export const httpMutation: HttpMutationFn = Object.assign(makeHttpMutationFn('json'), {
  text: makeHttpMutationFn('text'),
  blob: makeHttpMutationFn('blob'),
  arrayBuffer: makeHttpMutationFn('arraybuffer'),
});
