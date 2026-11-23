import type { HttpResponse } from '@angular/common/http';

/** Rejects a call whose `parse` threw: the write was applied, don't retry it. */
export class HttpMutationParseError extends Error {
  override readonly name = 'HttpMutationParseError';
  readonly response: HttpResponse<unknown>;

  constructor(response: HttpResponse<unknown>, cause: unknown) {
    super(`parse() threw on a ${response.status} response: the server applied the write`, { cause });
    this.response = response;
  }
}
