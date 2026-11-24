import {
  HttpErrorResponse,
  HttpEvent,
  HttpEventType,
  HttpHeaders,
  HttpInterceptorFn,
  HttpResponse,
} from '@angular/common/http';
import { Observable, concatMap, from, of, throwError } from 'rxjs';
import { delay } from 'rxjs/operators';
import { User } from './fake-api';

export interface UploadedAvatar {
  fileName: string;
  size: number;
}

let nextId = 3;

function readName(body: unknown): string {
  return (body as { name?: string } | null)?.name ?? '';
}

function created(user: User): HttpResponse<User> {
  return new HttpResponse({
    status: 201,
    statusText: 'Created',
    headers: new HttpHeaders({ Location: `/api/users/${user.id}` }),
    body: user,
  });
}

/** A few UploadProgress events sized on the real file, then the response. */
function simulateAvatarUpload(file: File): Observable<HttpEvent<UploadedAvatar>> {
  const steps = 5;
  const events: HttpEvent<UploadedAvatar>[] = Array.from({ length: steps }, (_, i) => ({
    type: HttpEventType.UploadProgress,
    loaded: Math.round((file.size * (i + 1)) / steps),
    total: file.size,
  }));
  events.push(
    new HttpResponse({ status: 201, statusText: 'Created', body: { fileName: file.name, size: file.size } }),
  );
  return from(events).pipe(concatMap((event) => of(event).pipe(delay(400))));
}

/** A few DownloadProgress events (only with reportProgress: true), then the file. */
function simulateCsvExport(reportProgress: boolean): Observable<HttpEvent<Blob>> {
  const file = new Blob(['id,name\n1,Ada Lovelace\n2,Alan Turing\n'], { type: 'text/csv' });
  const steps = 5;
  const progress: HttpEvent<Blob>[] = Array.from({ length: steps }, (_, i) => ({
    type: HttpEventType.DownloadProgress,
    loaded: Math.round((file.size * (i + 1)) / steps),
    total: file.size,
  }));
  const response = new HttpResponse({ status: 200, statusText: 'OK', body: file });
  const events = reportProgress ? [...progress, response] : [response];
  return from(events).pipe(concatMap((event) => of(event).pipe(delay(400))));
}

/** Stands in for a server behind `HttpClient`, with artificial delays. */
export const fakeHttpBackend: HttpInterceptorFn = (req, next) => {
  if (req.method !== 'POST') {
    return next(req);
  }

  switch (req.url) {
    case '/api/users': {
      const name = readName(req.body);
      if (name.trim().length === 0) {
        return throwError(
          () => new HttpErrorResponse({ status: 422, statusText: $localize`Name must not be empty`, url: req.url }),
        ).pipe(delay(2000));
      }
      return of(created({ id: String(nextId++), name })).pipe(delay(2000));
    }
    // Answers with an outdated body shape, to show what parse() does with a contract mismatch.
    case '/api/users/outdated':
      return of(
        new HttpResponse({
          status: 201,
          statusText: 'Created',
          body: { userId: nextId++, fullName: readName(req.body) },
        }),
      ).pipe(delay(2000));
    case '/api/avatar': {
      const file = (req.body as FormData).get('avatar') as File;
      return simulateAvatarUpload(file);
    }
    case '/api/exports/users':
      return simulateCsvExport(req.reportProgress);
    // Plain-text body: the number of purged users.
    case '/api/users/purge-inactive':
      return of(new HttpResponse({ status: 200, statusText: 'OK', body: '2' })).pipe(delay(2000));
    default:
      return next(req);
  }
};
