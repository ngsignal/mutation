import {
  HttpClient,
  HttpErrorResponse,
  HttpEventType,
  type HttpEvent,
  type HttpHeaders,
  type HttpProgressEvent,
  type HttpResourceRequest,
  type HttpResponse,
  type HttpResponseBase,
} from '@angular/common/http';
import { Injector, assertInInjectionContext, inject, signal, type Signal } from '@angular/core';
import { filter, map, tap } from 'rxjs/operators';
import { createMutation } from '../core/mutation.js';
import type { MutationCallbackContext, MutationOptions, MutationRef } from '../core/mutation.types.js';
import { toAbortablePromise } from '../internal/to-abortable-promise.js';

/** `httpResource()`'s request, except `method` is required and there is no `transferCache`, which only applies to reads. */
// Derived from HttpResourceRequest so it can't drift from what Angular accepts.
export type HttpMutationRequest = Omit<HttpResourceRequest, 'method' | 'transferCache'> & {
  // `string & {}` keeps autocompletion for the common methods while still accepting any string.
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' | (string & {});
};

/** Last argument of `httpMutation()`'s `onSuccess`, `onError` and `onSettled`. */
export interface HttpMutationCallbackContext extends MutationCallbackContext {
  /** This call's response or error response, `undefined` if none came back. */
  readonly response: HttpResponseBase | undefined;
}

/** Rejects a call whose `parse` threw: the write was applied, don't retry it. */
export class HttpMutationParseError extends Error {
  override readonly name = 'HttpMutationParseError';
  readonly response: HttpResponse<unknown>;

  constructor(response: HttpResponse<unknown>, cause: unknown) {
    super(`parse() threw on a ${response.status} response: the server applied the write`, { cause });
    this.response = response;
  }
}

/** Options of `httpMutation()`: `mutation()`'s options, with `request` and `parse` in place of `mutationFn`. */
export interface HttpMutationOptions<TInput, TOutput, TError = unknown, TRaw = unknown>
  extends Omit<MutationOptions<TInput, TOutput, TError, HttpMutationCallbackContext>, 'mutationFn'> {
  /**
   * Describes the request for an input, e.g. `(user) => ({ method: 'POST', url: '/api/users', body: user })`.
   * With `concurrency: 'queue'`, it runs when the call leaves the queue: pass values to freeze at
   * `mutate()` time through the input.
   *
   * If the request completes without an `HttpResponse` (an interceptor returning `EMPTY`), the call
   * fails with `Error('Request completed without an HttpResponse event')`.
   */
  request: (input: TInput) => HttpMutationRequest;
  /**
   * Transforms or validates the response body before it resolves the call, e.g. a schema's `parse`.
   * Receives `null` for a body-less response (`204`). If it throws, the call fails with an
   * `HttpMutationParseError`.
   */
  parse?: (raw: TRaw) => TOutput;
}

/** Options of `httpMutation.text()`, `.blob()` and `.arrayBuffer()`: `parse` is required when `TOutput` isn't the raw body type. */
type HttpMutationRawBodyOptions<TInput, TOutput, TError, TRaw> =
  HttpMutationOptions<TInput, TOutput, TError, TRaw> &
  ([TRaw] extends [TOutput] ? unknown : { parse: (raw: TRaw) => TOutput });

/** Returned by `httpMutation()`: a `MutationRef` plus the HTTP metadata of the latest request sent, cleared when a request starts and on `reset()`. */
export interface HttpMutationRef<TInput, TOutput, TError = unknown, TValue = TOutput | undefined>
  extends MutationRef<TInput, TOutput, TError, TValue> {
  /** Latest upload progress event. Needs `reportProgress: true`, and `withXhr()` on Angular 22+ (`fetch` ignores it silently). */
  readonly uploadProgress: Signal<HttpProgressEvent | undefined>;
  /** Latest download progress event. Needs `reportProgress: true`. */
  readonly downloadProgress: Signal<HttpProgressEvent | undefined>;
  /** Status code of the `HttpResponse`, or of the `HttpErrorResponse` when the request fails. Kept when `parse` throws. */
  readonly statusCode: Signal<number | undefined>;
  /** Headers of the `HttpResponse`, or of the `HttpErrorResponse` when the request fails. */
  readonly headers: Signal<HttpHeaders | undefined>;
  /** Checks `value() !== undefined`, so a body-less response (`204`) counts: it resolves to `null`. */
  hasValue(): this is HttpMutationRef<TInput, TOutput, TError, TOutput>;
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
  const options = requestOptions as Omit<typeof requestOptions, LooselyTypedField> & HttpClientLooselyTypedFields;
  return http.request<unknown>(method, url, {
    ...options,
    observe: 'events',
    // Typed as 'json' to pick the `HttpEvent<unknown>` overload: each variant's signature types the body.
    responseType: responseType as 'json',
  });
}

type HttpMutationRawBodyFn<TRaw> = <TInput = void, TOutput = TRaw, TError = unknown>(
  options: HttpMutationRawBodyOptions<TInput, TOutput, TError, TRaw>,
) => HttpMutationRef<TInput, TOutput, TError>;

/** Type of `httpMutation`: its JSON call signature, plus `.text()`, `.blob()` and `.arrayBuffer()` for other response bodies. */
export interface HttpMutationFn {
  /** Creates a mutation that sends an `HttpClient` request per call, with the response body parsed as JSON. */
  <TInput = void, TOutput = unknown, TError = unknown>(
    options: HttpMutationOptions<TInput, TOutput, TError>,
  ): HttpMutationRef<TInput, TOutput, TError>;
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
  ): HttpMutationRef<TInput, TOutput, TError> {
    if (!options.injector) {
      assertInInjectionContext(httpMutation);
    }
    const { request, parse, ...mutationOptions } = options;
    const injector = options.injector ?? inject(Injector);
    const http = injector.get(HttpClient);
    const responseState = createHttpResponseState();

    const readBody = (response: HttpResponse<unknown>): TOutput => {
      if (!parse) {
        return response.body as TOutput;
      }
      try {
        return parse(response.body as never);
      } catch (cause) {
        throw new HttpMutationParseError(response, cause);
      }
    };

    const mutationRef = createMutation<TInput, TOutput, TError, { response: HttpResponseBase | undefined }>(
      { ...mutationOptions, injector },
      {
        createContext: () => ({ response: undefined }),
        run: (input, { abortSignal, context }) => {
          const call = responseState.startCall();
          const body$ = sendRequest(http, request(input), responseType).pipe(
            tap({
              next: call.recordEvent,
              error: (error: unknown) => {
                if (error instanceof HttpErrorResponse) context.response = error;
                call.recordError(error);
              },
            }),
            filter((event) => event.type === HttpEventType.Response),
            map((response) => {
              context.response = response;
              return readBody(response);
            }),
          );
          return toAbortablePromise(body$, abortSignal, 'Request completed without an HttpResponse event');
        },
        onReset: responseState.clear,
      },
    );

    // Re-declared so the type guard narrows to HttpMutationRef, not MutationRef.
    return {
      ...mutationRef,
      ...responseState.signals,
      hasValue(): this is HttpMutationRef<TInput, TOutput, TError, TOutput> {
        return mutationRef.hasValue();
      },
    };
  };
}

/**
 * Creates a mutation that sends an `HttpClient` request per call, the mutation counterpart of
 * `httpResource()`: interceptors and `HttpTestingController` apply. The body is parsed as JSON: use
 * `.text()`, `.blob()` or `.arrayBuffer()` for other responses.
 *
 * Must run in an injection context, or receive `options.injector`.
 *
 * @example
 * ```ts
 * readonly createUser = httpMutation<CreateUserDto, User>({
 *   request: (dto) => ({ method: 'POST', url: '/api/users', body: dto }),
 * });
 * ```
 *
 * @see https://github.com/ngsignal/mutation/blob/main/docs/RECIPES.md#describing-an-http-request
 */
export const httpMutation: HttpMutationFn = Object.assign(makeHttpMutationFn('json'), {
  text: makeHttpMutationFn('text'),
  blob: makeHttpMutationFn('blob'),
  arrayBuffer: makeHttpMutationFn('arraybuffer'),
});
