import {
  HttpErrorResponse,
  HttpEventType,
  HttpResponse,
  provideHttpClient,
  withInterceptors,
  type HttpInterceptorFn,
  type HttpProgressEvent,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { EnvironmentInjector, createEnvironmentInjector, provideZonelessChangeDetection, signal, type Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { expectTypeOf } from 'vitest';
import { httpMutation, type HttpMutationRequest } from './http-mutation';
import { failWith } from './testing/rxjs';

interface User {
  id: number;
  name: string;
}

let httpTesting: HttpTestingController;

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()],
  });
  httpTesting = TestBed.inject(HttpTestingController);
});

afterEach(() => {
  httpTesting.verify();
});

function createUserMutation() {
  return TestBed.runInInjectionContext(() =>
    httpMutation<string, User>({
      request: (name) => ({ method: 'POST', url: '/api/users', body: { name } }),
    }),
  );
}

describe('request', () => {
  it('sends the described request and resolves with the response body', async () => {
    const m = TestBed.runInInjectionContext(() =>
      httpMutation<string, User>({
        request: (name) => ({
          method: 'POST',
          url: '/api/users',
          body: { name },
          headers: { 'X-Trace': 'abc' },
          params: { notify: true },
          keepalive: true,
        }),
      }),
    );

    expect(m.status()).toBe('idle');
    const call = m.mutate('Ada');
    expect(m.status()).toBe('pending');

    const req = httpTesting.expectOne('/api/users?notify=true');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Ada' });
    expect(req.request.headers.get('X-Trace')).toBe('abc');
    expect(req.request.keepalive).toBe(true);
    req.flush({ id: 1, name: 'Ada' });

    await expect(call).resolves.toEqual({ id: 1, name: 'Ada' });
    expect(m.status()).toBe('success');
    expect(m.value()).toEqual({ id: 1, name: 'Ada' });
  });

  it('passes the input and response body to onSuccess', async () => {
    const onSuccess = vi.fn();
    const m = TestBed.runInInjectionContext(() =>
      httpMutation<string, User>({
        request: (name) => ({ method: 'POST', url: '/api/users', body: { name } }),
        onSuccess,
      }),
    );

    const call = m.mutate('Ada');
    httpTesting.expectOne('/api/users').flush({ id: 1, name: 'Ada' });
    await call;

    expect(onSuccess).toHaveBeenCalledWith({ id: 1, name: 'Ada' }, 'Ada');
  });

  it('goes into error state with the HttpErrorResponse', async () => {
    const m = createUserMutation();

    const call = m.mutate('Ada').catch(() => undefined);
    httpTesting.expectOne('/api/users').flush({ message: 'invalid' }, { status: 422, statusText: 'Unprocessable' });
    await call;

    expect(m.status()).toBe('error');
    expect(m.error()).toBeInstanceOf(HttpErrorResponse);
    expect((m.error() as HttpErrorResponse).error).toEqual({ message: 'invalid' });
  });

  it('resolves with null for a response without a body (204)', async () => {
    const m = TestBed.runInInjectionContext(() =>
      httpMutation<string, null>({ request: (id) => ({ method: 'DELETE', url: `/api/users/${id}` }) }),
    );

    const call = m.mutate('1');
    httpTesting.expectOne('/api/users/1').flush(null, { status: 204, statusText: 'No Content' });

    await expect(call).resolves.toBeNull();
    expect(m.status()).toBe('success');
    expect(m.statusCode()).toBe(204);
    expect(m.hasValue()).toBe(true);
  });

  it('goes into error state when request() throws, without sending anything', async () => {
    const failure = new Error('invalid input');
    const m = TestBed.runInInjectionContext(() =>
      httpMutation<string, User>({
        request: () => {
          throw failure;
        },
      }),
    );

    await expect(m.mutate('Ada')).rejects.toBe(failure);
    expect(m.status()).toBe('error');
    expect(m.error()).toBe(failure);
  });

  it('requires a method (no silent GET default)', () => {
    expectTypeOf<{ url: string }>().not.toMatchTypeOf<HttpMutationRequest>();
    expectTypeOf<{ method: 'POST'; url: string }>().toMatchTypeOf<HttpMutationRequest>();
  });

  it('throws outside an injection context when no injector is given', () => {
    expect(() => httpMutation<string, User>({ request: (name) => ({ method: 'POST', url: '/api/users', body: { name } }) })).toThrow(/httpMutation/);
  });
});

describe('parse', () => {
  it('resolves with the parsed body and infers the output type from parse', async () => {
    const onSuccess = vi.fn();
    const m = TestBed.runInInjectionContext(() =>
      httpMutation({
        request: (name: string) => ({ method: 'POST', url: '/api/users', body: { name } }),
        parse: (raw) => ({ ...(raw as User), createdAt: new Date(0) }),
        onSuccess,
      }),
    );
    expectTypeOf(m.value).toEqualTypeOf<Signal<{ id: number; name: string; createdAt: Date } | undefined>>();

    const call = m.mutate('Ada');
    httpTesting.expectOne('/api/users').flush({ id: 1, name: 'Ada' });

    await expect(call).resolves.toEqual({ id: 1, name: 'Ada', createdAt: new Date(0) });
    expect(m.value()).toEqual({ id: 1, name: 'Ada', createdAt: new Date(0) });
    expect(onSuccess).toHaveBeenCalledWith({ id: 1, name: 'Ada', createdAt: new Date(0) }, 'Ada');
  });

  it('fails the call with the parse error, keeping the status code of the applied write', async () => {
    const invalid = new Error('invalid body');
    const m = TestBed.runInInjectionContext(() =>
      httpMutation<string, User>({
        request: (name) => ({ method: 'POST', url: '/api/users', body: { name } }),
        parse: () => {
          throw invalid;
        },
      }),
    );

    const call = m.mutate('Ada');
    httpTesting.expectOne('/api/users').flush({ unexpected: true }, { status: 201, statusText: 'Created' });

    await expect(call).rejects.toBe(invalid);
    expect(m.status()).toBe('error');
    expect(m.error()).toBe(invalid);
    expect(m.statusCode()).toBe(201);
  });
});

describe('response body variants', () => {
  it('httpMutation.text() reads the body as a string', async () => {
    const m = TestBed.runInInjectionContext(() =>
      httpMutation.text<string>({ request: (csv) => ({ method: 'POST', url: '/api/import', body: csv }) }),
    );
    expectTypeOf(m.value).toEqualTypeOf<Signal<string | undefined>>();

    const call = m.mutate('a,b');
    const req = httpTesting.expectOne('/api/import');
    expect(req.request.responseType).toBe('text');
    req.flush('42 rows imported');

    await expect(call).resolves.toBe('42 rows imported');
  });

  it('httpMutation.text() infers the output type from parse', async () => {
    const m = TestBed.runInInjectionContext(() =>
      httpMutation.text({
        request: (csv: string) => ({ method: 'POST', url: '/api/import', body: csv }),
        parse: (raw) => Number.parseInt(raw, 10),
      }),
    );
    expectTypeOf(m.value).toEqualTypeOf<Signal<number | undefined>>();

    const call = m.mutate('a,b');
    httpTesting.expectOne('/api/import').flush('42');

    await expect(call).resolves.toBe(42);
  });

  it('httpMutation.blob() reads the body as a Blob', async () => {
    const m = TestBed.runInInjectionContext(() =>
      httpMutation.blob<number>({ request: (id) => ({ method: 'POST', url: `/api/invoices/${id}/pdf` }) }),
    );
    expectTypeOf(m.value).toEqualTypeOf<Signal<Blob | undefined>>();

    const pdf = new Blob(['%PDF'], { type: 'application/pdf' });
    const call = m.mutate(1);
    const req = httpTesting.expectOne('/api/invoices/1/pdf');
    expect(req.request.responseType).toBe('blob');
    req.flush(pdf);

    await expect(call).resolves.toBe(pdf);
  });

  it('httpMutation.arrayBuffer() reads the body as an ArrayBuffer', async () => {
    const m = TestBed.runInInjectionContext(() =>
      httpMutation.arrayBuffer<number>({ request: (id) => ({ method: 'POST', url: `/api/exports/${id}` }) }),
    );
    expectTypeOf(m.value).toEqualTypeOf<Signal<ArrayBuffer | undefined>>();

    const buffer = new ArrayBuffer(8);
    const call = m.mutate(1);
    const req = httpTesting.expectOne('/api/exports/1');
    expect(req.request.responseType).toBe('arraybuffer');
    req.flush(buffer);

    await expect(call).resolves.toBe(buffer);
  });

  it('requires parse when the output type is not the raw body type', () => {
    TestBed.runInInjectionContext(() => {
      // @ts-expect-error: a Blob body can't resolve a `number` without parse
      httpMutation.blob<string, number>({ request: (id) => ({ method: 'POST', url: `/api/${id}` }) });
      httpMutation.blob<string, number>({ request: (id) => ({ method: 'POST', url: `/api/${id}` }), parse: (blob) => blob.size });
    });
    expect(httpTesting.match(() => true)).toEqual([]);
  });

  it('throws outside an injection context when no injector is given', () => {
    expect(() => httpMutation.blob<string>({ request: (id) => ({ method: 'POST', url: `/api/${id}` }) })).toThrow(/httpMutation/);
  });
});

describe('statusCode / headers', () => {
  it('exposes the status code and headers of the HttpResponse', async () => {
    const m = createUserMutation();
    expect(m.statusCode()).toBeUndefined();
    expect(m.headers()).toBeUndefined();

    const call = m.mutate('Ada');
    httpTesting
      .expectOne('/api/users')
      .flush({ id: 1, name: 'Ada' }, { status: 201, statusText: 'Created', headers: { Location: '/api/users/1' } });
    await call;

    expect(m.statusCode()).toBe(201);
    expect(m.headers()?.get('Location')).toBe('/api/users/1');
  });

  it('exposes the status code and headers of an HttpErrorResponse', async () => {
    const m = createUserMutation();

    const call = m.mutate('Ada').catch(() => undefined);
    httpTesting
      .expectOne('/api/users')
      .flush(null, { status: 409, statusText: 'Conflict', headers: { 'X-Reason': 'duplicate' } });
    await call;

    expect(m.status()).toBe('error');
    expect(m.statusCode()).toBe(409);
    expect(m.headers()?.get('X-Reason')).toBe('duplicate');
  });

  it('resets to undefined at the start of each mutate() call', async () => {
    const m = createUserMutation();

    const first = m.mutate('Ada');
    httpTesting.expectOne('/api/users').flush({ id: 1, name: 'Ada' }, { status: 201, statusText: 'Created' });
    await first;
    expect(m.statusCode()).toBe(201);

    const second = m.mutate('Grace');
    expect(m.statusCode()).toBeUndefined();
    expect(m.headers()).toBeUndefined();

    httpTesting.expectOne('/api/users').flush({ id: 2, name: 'Grace' });
    await second;
  });

  it('ignores the response of a superseded call', async () => {
    const m = createUserMutation();

    const first = m.mutate('Ada');
    const second = m.mutate('Grace');
    const [firstReq, secondReq] = httpTesting.match('/api/users');

    secondReq.flush({ id: 2, name: 'Grace' }, { status: 200, statusText: 'OK' });
    firstReq.flush({ id: 1, name: 'Ada' }, { status: 201, statusText: 'Created' });
    await Promise.all([first, second]);

    expect(m.value()).toEqual({ id: 2, name: 'Grace' });
    expect(m.statusCode()).toBe(200);
  });

  it('ignores the error response of a superseded call', async () => {
    const m = createUserMutation();

    const first = m.mutate('Ada').catch(() => undefined);
    const second = m.mutate('Grace');
    const [firstReq, secondReq] = httpTesting.match('/api/users');

    secondReq.flush({ id: 2, name: 'Grace' }, { status: 201, statusText: 'Created' });
    firstReq.flush(null, { status: 500, statusText: 'Server Error' });
    await Promise.all([first, second]);

    expect(m.status()).toBe('success');
    expect(m.statusCode()).toBe(201);
  });

  it('stays undefined when the request fails with a non-HTTP error', async () => {
    const failure = new Error('interceptor failure');
    const injector = createEnvironmentInjector(
      [provideHttpClient(withInterceptors([() => failWith(failure)]))],
      TestBed.inject(EnvironmentInjector),
    );
    const m = httpMutation<string, User>({
      request: (name) => ({ method: 'POST', url: '/api/users', body: { name } }),
      injector,
    });

    await expect(m.mutate('Ada')).rejects.toBe(failure);
    expect(m.error()).toBe(failure);
    expect(m.statusCode()).toBeUndefined();
    expect(m.headers()).toBeUndefined();
  });
});

describe('an exception while recording statusCode/headers', () => {
  // Can't happen through signal writes today; guards that the call still settles, like tap() did.
  function throwingStatus<T extends object>(target: T, recordingError: Error): T {
    return Object.defineProperty(target, 'status', {
      get() {
        throw recordingError;
      },
    });
  }

  function mutationWithInterceptor(interceptor: HttpInterceptorFn) {
    const injector = createEnvironmentInjector(
      [provideHttpClient(withInterceptors([interceptor]))],
      TestBed.inject(EnvironmentInjector),
    );
    return httpMutation<string, User>({
      request: (name) => ({ method: 'POST', url: '/api/users', body: { name } }),
      injector,
    });
  }

  it('errors the call when recording the response throws', async () => {
    const recordingError = new Error('recording failed');
    const response = throwingStatus(new HttpResponse({ status: 201, body: { id: 1, name: 'Ada' } }), recordingError);
    const m = mutationWithInterceptor(() => of(response));

    await expect(m.mutate('Ada')).rejects.toBe(recordingError);
    expect(m.error()).toBe(recordingError);
  });

  it('still settles the call when recording an HTTP error throws', async () => {
    const recordingError = new Error('recording failed');
    const failure = throwingStatus(new HttpErrorResponse({ status: 500 }), recordingError);
    const m = mutationWithInterceptor(() => failWith(failure));

    await expect(m.mutate('Ada')).rejects.toBe(recordingError);
    expect(m.status()).toBe('error');
  });
});

describe('progress', () => {
  function uploadMutation() {
    return TestBed.runInInjectionContext(() =>
      httpMutation<Blob, User>({
        request: (file) => ({ method: 'POST', url: '/api/avatar', body: file, reportProgress: true }),
      }),
    );
  }

  it('forwards reportProgress to the request', async () => {
    const m = uploadMutation();

    const call = m.mutate(new Blob(['x']));
    const req = httpTesting.expectOne('/api/avatar');
    expect(req.request.reportProgress).toBe(true);

    req.flush({ id: 1, name: 'Ada' });
    await call;
  });

  it('keeps upload and download progress apart through a whole request', async () => {
    const m = uploadMutation();

    const call = m.mutate(new Blob(['x']));
    const req = httpTesting.expectOne('/api/avatar');

    req.event({ type: HttpEventType.UploadProgress, loaded: 100, total: 100 });
    expect(m.uploadProgress()).toMatchObject({ loaded: 100, total: 100 });
    expect(m.downloadProgress()).toBeUndefined();

    // The response is smaller than the upload: the upload bar must not jump back.
    req.event({ type: HttpEventType.DownloadProgress, loaded: 1, total: 2 });
    expect(m.uploadProgress()).toMatchObject({ loaded: 100, total: 100 });
    expect(m.downloadProgress()).toMatchObject({ loaded: 1, total: 2 });

    req.flush({ id: 1, name: 'Ada' });
    await call;
    expect(m.uploadProgress()).toMatchObject({ loaded: 100, total: 100 });
    expect(m.downloadProgress()).toMatchObject({ loaded: 1, total: 2 });
  });

  describe.each([
    { signal: 'uploadProgress', other: 'downloadProgress', type: HttpEventType.UploadProgress },
    { signal: 'downloadProgress', other: 'uploadProgress', type: HttpEventType.DownloadProgress },
  ] as const)('$signal', ({ signal, other, type }) => {
    it('holds the last event of its own type only', async () => {
      const m = uploadMutation();

      const call = m.mutate(new Blob(['x']));
      const req = httpTesting.expectOne('/api/avatar');
      expect(m[signal]()).toBeUndefined();

      req.event({ type, loaded: 50, total: 100 });
      expect(m[signal]()).toMatchObject({ type, loaded: 50, total: 100 });
      expect(m[other]()).toBeUndefined();

      req.event({ type, loaded: 100, total: 100 });
      expect(m[signal]()).toMatchObject({ type, loaded: 100, total: 100 });

      req.flush({ id: 1, name: 'Ada' });
      await call;
    });

    it('resets to undefined at the start of each mutate() call', async () => {
      const m = uploadMutation();

      const first = m.mutate(new Blob(['a']));
      const firstReq = httpTesting.expectOne('/api/avatar');
      firstReq.event({ type, loaded: 100, total: 100 });
      firstReq.flush({ id: 1, name: 'Ada' });
      await first;
      expect(m[signal]()).toBeDefined();

      const second = m.mutate(new Blob(['b']));
      expect(m[signal]()).toBeUndefined();

      httpTesting.expectOne('/api/avatar').flush({ id: 2, name: 'Grace' });
      await second;
    });

    it('ignores events from a superseded call', async () => {
      const m = uploadMutation();

      const first = m.mutate(new Blob(['a']));
      const second = m.mutate(new Blob(['b']));
      const [firstReq, secondReq] = httpTesting.match('/api/avatar');

      firstReq.event({ type, loaded: 10, total: 100 });
      expect(m[signal]()).toBeUndefined();

      secondReq.event({ type, loaded: 90, total: 100 });
      firstReq.event({ type, loaded: 20, total: 100 });
      expect(m[signal]()).toMatchObject({ loaded: 90, total: 100 });

      firstReq.flush({ id: 1, name: 'Ada' });
      secondReq.flush({ id: 2, name: 'Grace' });
      await Promise.all([first, second]);
    });
  });

  it('keeps the HTTP signals in the narrowed type after hasValue()', async () => {
    const m = createUserMutation();
    const call = m.mutate('Ada');
    httpTesting.expectOne('/api/users').flush({ id: 1, name: 'Ada' });
    await call;

    expect(m.hasValue()).toBe(true);
    if (m.hasValue()) {
      expectTypeOf(m.value).toEqualTypeOf<Signal<User>>();
      expectTypeOf(m.uploadProgress).toEqualTypeOf<Signal<HttpProgressEvent | undefined>>();
      expectTypeOf(m.downloadProgress).toEqualTypeOf<Signal<HttpProgressEvent | undefined>>();
    }
  });
});

describe('concurrency: "queue"', () => {
  const nextTask = () => new Promise((resolve) => setTimeout(resolve));

  function queuedUpload() {
    return TestBed.runInInjectionContext(() =>
      httpMutation<string, string>({
        concurrency: 'queue',
        request: (name) => ({ method: 'POST', url: '/api/files', body: name, reportProgress: true }),
      }),
    );
  }

  it('sends the queued request only once the previous one settles', async () => {
    const m = queuedUpload();

    const first = m.mutate('a');
    const second = m.mutate('b');
    await nextTask();

    const firstReq = httpTesting.expectOne('/api/files');
    expect(firstReq.request.body).toBe('a');
    firstReq.flush('first', { status: 201, statusText: 'Created' });
    await first;
    await nextTask();

    const secondReq = httpTesting.expectOne('/api/files');
    expect(secondReq.request.body).toBe('b');
    secondReq.flush('second', { status: 200, statusText: 'OK' });
    await second;

    expect(m.value()).toBe('second');
    expect(m.statusCode()).toBe(200);
  });

  it('calls request() when the queued request starts, not when mutate() is called', async () => {
    const etag = signal('v1');
    const request = vi.fn((name: string) => ({ method: 'PUT', url: '/api/files', body: name, headers: { 'If-Match': etag() } }));
    const m = TestBed.runInInjectionContext(() => httpMutation<string, string>({ concurrency: 'queue', request }));

    const first = m.mutate('a');
    const second = m.mutate('b');
    await nextTask();
    expect(request).toHaveBeenCalledTimes(1);

    etag.set('v2');
    httpTesting.expectOne('/api/files').flush('first');
    await first;
    await nextTask();

    expect(request).toHaveBeenCalledTimes(2);
    const secondReq = httpTesting.expectOne('/api/files');
    expect(secondReq.request.headers.get('If-Match')).toBe('v2');
    secondReq.flush('second');
    await second;
  });

  it('reports the progress of the request actually in flight, even if a newer call is queued', async () => {
    const m = queuedUpload();

    const first = m.mutate('a');
    await nextTask();
    const second = m.mutate('b');
    const firstReq = httpTesting.expectOne('/api/files');

    firstReq.event({ type: HttpEventType.UploadProgress, loaded: 50, total: 100 });
    expect(m.uploadProgress()).toMatchObject({ loaded: 50, total: 100 });

    firstReq.flush('first');
    await first;
    await nextTask();
    expect(m.uploadProgress()).toBeUndefined();

    httpTesting.expectOne('/api/files').flush('second');
    await second;
    expect(m.value()).toBe('second');
  });
});

describe('concurrency: "drop"', () => {
  it('does not clear the signals of the request in flight when a call is dropped', async () => {
    const m = TestBed.runInInjectionContext(() =>
      httpMutation<string, string>({
        concurrency: 'drop',
        request: (name) => ({ method: 'POST', url: '/api/files', body: name, reportProgress: true }),
      }),
    );

    const first = m.mutate('a');
    const req = httpTesting.expectOne('/api/files');
    req.event({ type: HttpEventType.UploadProgress, loaded: 50, total: 100 });

    await expect(m.mutate('b')).rejects.toMatchObject({ name: 'AbortError' });
    expect(m.uploadProgress()).toMatchObject({ loaded: 50, total: 100 });

    req.flush('first', { status: 201, statusText: 'Created' });
    await first;
    expect(m.statusCode()).toBe(201);
  });
});

describe('reset()', () => {
  it('clears progress, statusCode and headers along with the mutation state', async () => {
    const m = createUserMutation();

    const call = m.mutate('Ada');
    const req = httpTesting.expectOne('/api/users');
    req.event({ type: HttpEventType.UploadProgress, loaded: 100, total: 100 });
    req.event({ type: HttpEventType.DownloadProgress, loaded: 10, total: 10 });
    req.flush({ id: 1, name: 'Ada' }, { status: 201, statusText: 'Created', headers: { Location: '/api/users/1' } });
    await call;

    m.reset();

    expect(m.status()).toBe('idle');
    expect(m.value()).toBeUndefined();
    expect(m.uploadProgress()).toBeUndefined();
    expect(m.statusCode()).toBeUndefined();
    expect(m.headers()).toBeUndefined();
  });

  it('cancels the request in flight', async () => {
    const m = createUserMutation();

    const call = m.mutate('Ada');
    const req = httpTesting.expectOne('/api/users');

    m.reset();

    await expect(call).rejects.toMatchObject({ name: 'AbortError' });
    expect(req.cancelled).toBe(true);
    expect(m.status()).toBe('idle');
  });
});

describe('cancellation', () => {
  it('cancels the request and rejects with AbortError when the injector is destroyed mid-flight', async () => {
    const childInjector = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
    const m = httpMutation<string, User>({
      request: (name) => ({ method: 'POST', url: '/api/users', body: { name } }),
      injector: childInjector,
    });

    const call = m.mutate('Ada');
    const req = httpTesting.expectOne('/api/users');

    childInjector.destroy();

    await expect(call).rejects.toMatchObject({ name: 'AbortError' });
    expect(req.cancelled).toBe(true);
  });
});
