import { HttpClient, HttpEventType, type HttpResponse } from '@angular/common/http';
import { Injector, assertInInjectionContext, inject } from '@angular/core';
import { filter, map, tap } from 'rxjs/operators';
import { createMutation } from '../core/mutation.js';
import { toAbortablePromise } from '../internal/to-abortable-promise.js';
import { HttpMutationParseError } from './http-mutation-parse-error.js';
import type { HttpMutationFn, HttpMutationOptions, HttpMutationRef } from './http-mutation.types.js';
import { createHttpResponseState, type HttpCallContext } from './http-response-state.js';
import { sendRequest, type ResponseType } from './send-request.js';

function readBody<TOutput>(response: HttpResponse<unknown>, parse: ((raw: never) => TOutput) | undefined): TOutput {
  if (!parse) {
    return response.body as TOutput;
  }
  try {
    return parse(response.body as never);
  } catch (cause) {
    throw new HttpMutationParseError(response, cause);
  }
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

    const mutationRef = createMutation<TInput, TOutput, TError, HttpCallContext>(
      { ...mutationOptions, injector },
      {
        createContext: () => ({ response: undefined }),
        run: (input, { abortSignal, context }) => {
          const recorder = responseState.startCall(context);
          const body$ = sendRequest(http, request(input), responseType).pipe(
            tap(recorder),
            filter((event) => event.type === HttpEventType.Response),
            map((response) => readBody(response, parse)),
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
