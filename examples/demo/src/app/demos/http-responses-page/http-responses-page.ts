import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { httpMutation } from '@ngsignal/mutation/http';
import { CodeBlock } from '../../shared/code-block';
import { User } from '../../shared/fake-api';
import html from './http-responses-page.html' with { loader: 'text' };
// @ts-expect-error: imported as text, see text-imports.d.ts
import ts from './http-responses-page.ts' with { loader: 'text' };

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
  imports: [DecimalPipe, CodeBlock],
  templateUrl: './http-responses-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HttpResponsesPage {
  protected readonly code = { ts: ts as string, html };

  // #region parse
  // `parse` runs on the JSON body before it resolves the call: its return type becomes TOutput.
  protected readonly createUser = httpMutation<string, User, HttpErrorResponse | Error>({
    request: (name) => ({ method: 'POST', url: '/api/users', body: { name } }),
    parse: parseUser,
  });
  // #endregion

  // The same call against an endpoint that answers with an outdated body shape.
  protected readonly createUserOutdated = httpMutation<string, User, HttpErrorResponse | Error>({
    request: (name) => ({ method: 'POST', url: '/api/users/outdated', body: { name } }),
    parse: parseUser,
  });

  protected create(name: string): void {
    this.createUser.mutate(name);
    this.createUserOutdated.mutate(name);
  }

  protected resetCreate(): void {
    this.createUser.reset();
    this.createUserOutdated.reset();
  }

  // #region blob
  // `.blob()` reads the body as a Blob: TOutput defaults to Blob, so `parse` is optional.
  protected readonly exportUsers = httpMutation.blob<void, Blob, HttpErrorResponse>({
    request: () => ({ method: 'POST', url: '/api/exports/users', reportProgress: true }),
  });
  // #endregion

  // #region text
  // `.text()` reads the body as a string: `parse` is required because TOutput is a number.
  protected readonly purgeInactive = httpMutation.text<void, number, HttpErrorResponse>({
    request: () => ({ method: 'POST', url: '/api/users/purge-inactive' }),
    parse: (raw) => Number(raw),
  });
  // #endregion

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
