import {
  HttpErrorResponse,
  HttpEventType,
  type HttpEvent,
  type HttpHeaders,
  type HttpProgressEvent,
  type HttpResponseBase,
} from '@angular/common/http';
import { signal } from '@angular/core';
import type { PartialObserver } from 'rxjs';

/** What `httpMutation()` adds to a call's callback context, filled from its events. */
export interface HttpCallContext {
  response: HttpResponseBase | undefined;
}

/** The HTTP signals of `HttpMutationRef`, fed by the latest request sent. */
export function createHttpResponseState() {
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

  function recordResponse(response: HttpResponseBase): void {
    statusCode.set(response.status);
    headers.set(response.headers);
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
        recordResponse(event);
        break;
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
    /**
     * Clears the signals for a new request. The returned observer always fills `context`, and
     * writes the signals until a newer request starts.
     */
    startCall(context: HttpCallContext): PartialObserver<HttpEvent<unknown>> {
      const callGeneration = ++generation;
      const isCurrent = () => callGeneration === generation;
      clear();
      return {
        next: (event) => {
          if (event.type === HttpEventType.Response) context.response = event;
          if (isCurrent()) recordEvent(event);
        },
        error: (error: unknown) => {
          if (!(error instanceof HttpErrorResponse)) return;
          context.response = error;
          if (isCurrent()) recordResponse(error);
        },
      };
    },
  };
}
