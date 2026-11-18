import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { httpMutation } from '@ngsignal/mutation/http';
import { User } from '../../shared/fake-api';

/** A hand-written check; a schema library's parse (Zod, Valibot…) plugs in the same way. */
function parseUser(raw: unknown): User {
  const candidate = raw as Partial<User> | null;
  if (typeof candidate?.id !== 'string' || typeof candidate?.name !== 'string') {
    throw new Error(`Unexpected response body: ${JSON.stringify(raw)}`);
  }
  return { id: candidate.id, name: candidate.name };
}

@Component({
  selector: 'app-http-responses-page',
  imports: [DecimalPipe],
  templateUrl: './http-responses-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HttpResponsesPage {
  // `parse` runs on the JSON body before it resolves the call: its return type becomes TOutput.
  protected readonly createUser = httpMutation<
    { name: string; outdated: boolean },
    User,
    HttpErrorResponse | Error
  >({
    request: ({ name, outdated }) => ({
      method: 'POST',
      url: outdated ? '/api/users/outdated' : '/api/users',
      body: { name },
    }),
    parse: parseUser,
  });

  // `.blob()` reads the body as a Blob: TOutput defaults to Blob, so `parse` is optional.
  protected readonly exportUsers = httpMutation.blob<void, Blob, HttpErrorResponse>({
    request: () => ({ method: 'POST', url: '/api/exports/users', reportProgress: true }),
  });

  // `.text()` reads the body as a string: `parse` is required because TOutput is a number.
  protected readonly purgeInactive = httpMutation.text<void, number, HttpErrorResponse>({
    request: () => ({ method: 'POST', url: '/api/users/purge-inactive' }),
    parse: (raw) => Number(raw),
  });

  protected saveExport(): void {
    if (!this.exportUsers.hasValue()) return;
    const url = URL.createObjectURL(this.exportUsers.value());
    const link = document.createElement('a');
    link.href = url;
    link.download = 'users.csv';
    link.click();
    URL.revokeObjectURL(url);
  }
}
