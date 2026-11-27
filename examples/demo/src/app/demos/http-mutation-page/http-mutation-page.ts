import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { httpMutation } from '@ngsignal/mutation/http';
import { CodeBlock } from '../../shared/code-block';
import { User } from '../../shared/fake-api';
import { UploadedAvatar } from '../../shared/fake-http-backend';
import html from './http-mutation-page.html' with { loader: 'text' };
// @ts-expect-error: imported as text, see text-imports.d.ts
import ts from './http-mutation-page.ts' with { loader: 'text' };

@Component({
  selector: 'app-http-mutation-page',
  imports: [DecimalPipe, CodeBlock],
  templateUrl: './http-mutation-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HttpMutationPage {
  protected readonly code = { ts: ts as string, html };

  // #region create
  protected readonly createUser = httpMutation<string, User, HttpErrorResponse>({
    request: (name) => ({ method: 'POST', url: '/api/users', body: { name } }),
  });
  // #endregion

  // #region upload
  protected readonly uploadAvatar = httpMutation<File, UploadedAvatar, HttpErrorResponse>({
    request: (file) => {
      const body = new FormData();
      body.append('avatar', file);
      return { method: 'POST', url: '/api/avatar', body, reportProgress: true };
    },
  });
  // #endregion

  protected upload(files: FileList | null): void {
    const file = files?.[0];
    if (file) this.uploadAvatar.mutate(file);
  }
}
