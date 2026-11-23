import type { HttpClient, HttpHeaders } from '@angular/common/http';
import type { HttpMutationRequest } from './http-mutation.types.js';

export type ResponseType = 'json' | 'text' | 'blob' | 'arraybuffer';

/**
 * The only `HttpResourceRequest` fields whose typings are looser than `HttpClient`'s: readonly
 * header arrays and `string & {}` for the fetch enums. HttpClient forwards them unchanged.
 */
interface HttpClientLooselyTypedFields {
  headers?: HttpHeaders | Record<string, string | string[]>;
  cache?: RequestCache;
  credentials?: RequestCredentials;
  priority?: RequestPriority;
  mode?: RequestMode;
  redirect?: RequestRedirect;
  referrerPolicy?: ReferrerPolicy;
}

/** Sends a request description through `HttpClient`, observing every event. */
export function sendRequest(
  http: HttpClient,
  { method, url, ...requestOptions }: HttpMutationRequest,
  responseType: ResponseType,
) {
  const options = requestOptions as Omit<typeof requestOptions, keyof HttpClientLooselyTypedFields> & HttpClientLooselyTypedFields;
  return http.request<unknown>(method, url, {
    ...options,
    observe: 'events',
    // Typed as 'json' to pick the `HttpEvent<unknown>` overload: each variant's signature types the body.
    responseType: responseType as 'json',
  });
}
