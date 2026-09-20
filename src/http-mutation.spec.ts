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
import { EnvironmentInjector, createEnvironmentInjector, provideZonelessChangeDetection, type Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { expectTypeOf } from 'vitest';
import { httpMutation } from './http-mutation';
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

  it('throws outside an injection context when no injector is given', () => {
    expect(() => httpMutation<string, User>({ request: (name) => ({ method: 'POST', url: '/api/users', body: { name } }) })).toThrow();
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

  it('forwards reportProgress and updates progress from progress events', async () => {
    const m = uploadMutation();

    const call = m.mutate(new Blob(['x']));
    const req = httpTesting.expectOne('/api/avatar');
    expect(req.request.reportProgress).toBe(true);

    req.event({ type: HttpEventType.UploadProgress, loaded: 50, total: 100 });
    expect(m.progress()).toMatchObject({ loaded: 50, total: 100 });

    req.event({ type: HttpEventType.UploadProgress, loaded: 100, total: 100 });
    req.flush({ id: 1, name: 'Ada' });
    await call;

    expect(m.status()).toBe('success');
    expect(m.progress()).toMatchObject({ loaded: 100, total: 100 });
  });

  it('ignores progress events from a superseded call', async () => {
    const m = uploadMutation();

    const first = m.mutate(new Blob(['a']));
    const second = m.mutate(new Blob(['b']));
    const [firstReq, secondReq] = httpTesting.match('/api/avatar');

    firstReq.event({ type: HttpEventType.UploadProgress, loaded: 10, total: 100 });
    expect(m.progress()).toBeUndefined();

    secondReq.event({ type: HttpEventType.UploadProgress, loaded: 90, total: 100 });
    expect(m.progress()).toMatchObject({ loaded: 90, total: 100 });

    firstReq.flush({ id: 1, name: 'Ada' });
    secondReq.flush({ id: 2, name: 'Grace' });
    await Promise.all([first, second]);
  });

  it('keeps the HTTP signals in the narrowed type after hasValue()', async () => {
    const m = createUserMutation();
    const call = m.mutate('Ada');
    httpTesting.expectOne('/api/users').flush({ id: 1, name: 'Ada' });
    await call;

    expect(m.hasValue()).toBe(true);
    if (m.hasValue()) {
      expectTypeOf(m.value).toEqualTypeOf<Signal<User>>();
      expectTypeOf(m.progress).toEqualTypeOf<Signal<HttpProgressEvent | undefined>>();
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

  it('reports the progress of the request actually in flight, even if a newer call is queued', async () => {
    const m = queuedUpload();

    const first = m.mutate('a');
    await nextTask();
    const second = m.mutate('b');
    const firstReq = httpTesting.expectOne('/api/files');

    firstReq.event({ type: HttpEventType.UploadProgress, loaded: 50, total: 100 });
    expect(m.progress()).toMatchObject({ loaded: 50, total: 100 });

    firstReq.flush('first');
    await first;
    await nextTask();
    expect(m.progress()).toBeUndefined();

    httpTesting.expectOne('/api/files').flush('second');
    await second;
    expect(m.value()).toBe('second');
  });
});

describe('reset()', () => {
  it('clears progress, statusCode and headers along with the mutation state', async () => {
    const m = createUserMutation();

    const call = m.mutate('Ada');
    const req = httpTesting.expectOne('/api/users');
    req.event({ type: HttpEventType.UploadProgress, loaded: 100, total: 100 });
    req.flush({ id: 1, name: 'Ada' }, { status: 201, statusText: 'Created', headers: { Location: '/api/users/1' } });
    await call;

    m.reset();

    expect(m.status()).toBe('idle');
    expect(m.value()).toBeUndefined();
    expect(m.progress()).toBeUndefined();
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
