import * as angularHttp from '@angular/common/http';
import {
  HttpErrorResponse,
  HttpEventType,
  provideHttpClient,
  withFetch,
  type HttpFeature,
  type HttpFeatureKind,
} from '@angular/common/http';
import { EnvironmentInjector, createEnvironmentInjector, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { httpMutation } from './http-mutation';
import { startHttpTestServer, type HttpTestServer } from './testing/http-test-server';

// Integration tests: real requests to a local server, through Angular's actual FetchBackend /
// HttpXhrBackend. Unit tests with HttpClientTestingBackend live in http-mutation.spec.ts.

interface User {
  id: number;
  name: string;
}

let server: HttpTestServer;

beforeAll(async () => {
  server = await startHttpTestServer();
});

afterAll(() => server.close());

beforeEach(() => {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
});

// `withXhr()` only exists since Angular 22, where fetch became the default; XHR is Angular 21's default.
const { withXhr } = angularHttp as { withXhr?: () => HttpFeature<HttpFeatureKind> };

describe.each([
  // Documented in RECIPES.md: fetch can't report upload progress, hence `withXhr()`.
  { backend: 'fetch', features: () => [withFetch()], reportsUploadProgress: false },
  { backend: 'XHR', features: () => (withXhr ? [withXhr()] : []), reportsUploadProgress: true },
])('$backend', ({ features, reportsUploadProgress }) => {
  let injector: EnvironmentInjector;

  beforeEach(() => {
    injector = createEnvironmentInjector([provideHttpClient(...features())], TestBed.inject(EnvironmentInjector));
  });

  afterEach(() => injector.destroy());

  it('sends the request and exposes the body, status code and headers', async () => {
    const m = httpMutation<string, User>({
      request: (name) => ({ method: 'POST', url: `${server.baseUrl}/users`, body: { name } }),
      injector,
    });

    await expect(m.mutate('Ada')).resolves.toEqual({ id: 1, name: 'Ada' });
    expect(m.statusCode()).toBe(201);
    expect(m.headers()?.get('Location')).toBe('/users/1');
  });

  it('resolves with null for a 204', async () => {
    const m = httpMutation<string, null>({
      request: (id) => ({ method: 'DELETE', url: `${server.baseUrl}/users/${id}` }),
      injector,
    });

    await expect(m.mutate('1')).resolves.toBeNull();
    expect(m.statusCode()).toBe(204);
  });

  it('goes into error state with the HttpErrorResponse', async () => {
    const m = httpMutation<string, User>({
      request: (name) => ({ method: 'POST', url: `${server.baseUrl}/invalid`, body: { name } }),
      injector,
    });

    await expect(m.mutate('Ada')).rejects.toBeInstanceOf(HttpErrorResponse);
    expect(m.statusCode()).toBe(422);
    expect((m.error() as HttpErrorResponse).error).toEqual({ message: 'invalid' });
  });

  it('reads a non-JSON body with httpMutation.blob()', async () => {
    const m = httpMutation.blob<void>({ request: () => ({ method: 'POST', url: `${server.baseUrl}/pdf` }), injector });

    const pdf = await m.mutate();
    expect(pdf).toBeInstanceOf(Blob);
    expect(pdf.size).toBe('%PDF-1.7'.length);
    expect(pdf.type).toBe('application/pdf');
  });

  it('aborts the request on the network on reset()', async () => {
    const slowRequestClosed = server.nextSlowRequestClosed();
    const m = httpMutation<void, User>({ request: () => ({ method: 'POST', url: `${server.baseUrl}/slow` }), injector });

    const call = m.mutate();
    await new Promise((resolve) => setTimeout(resolve, 50));
    m.reset();

    await expect(call).rejects.toMatchObject({ name: 'AbortError' });
    await slowRequestClosed;
  });

  it(`reports download progress, ${reportsUploadProgress ? 'and' : 'but not'} upload progress`, async () => {
    const body = 'x'.repeat(100_000);
    const m = httpMutation<string, { received: number }>({
      request: (text) => ({ method: 'POST', url: `${server.baseUrl}/upload`, body: text, reportProgress: true }),
      injector,
    });

    await expect(m.mutate(body)).resolves.toEqual({ received: body.length });
    expect(m.downloadProgress()).toMatchObject({ type: HttpEventType.DownloadProgress });
    expect(m.uploadProgress()?.loaded).toBe(reportsUploadProgress ? body.length : undefined);
  });
});
