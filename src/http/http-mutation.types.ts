import type { HttpHeaders, HttpProgressEvent, HttpResourceRequest, HttpResponseBase } from '@angular/common/http';
import type { Signal } from '@angular/core';
import type { MutationCallbackContext, MutationOptions, MutationRef } from '../core/mutation.types.js';

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

type HttpMutationRawBodyFn<TRaw> = <TInput = void, TOutput = TRaw, TError = unknown>(
  options: HttpMutationRawBodyOptions<TInput, TOutput, TError, TRaw>,
) => HttpMutationRef<TInput, TOutput, TError>;

/** Options of `httpMutation.text()`, `.blob()` and `.arrayBuffer()`: `parse` is required when `TOutput` isn't the raw body type. */
type HttpMutationRawBodyOptions<TInput, TOutput, TError, TRaw> =
  HttpMutationOptions<TInput, TOutput, TError, TRaw> &
  ([TRaw] extends [TOutput] ? unknown : { parse: (raw: TRaw) => TOutput });
