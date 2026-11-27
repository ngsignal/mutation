import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { rxMutation } from '@ngsignal/mutation/rxjs-interop';
import { RouterLink } from '@angular/router';
import { CodeBlock } from '../../shared/code-block';
import { User } from '../../shared/fake-api';
import html from './rx-mutation-page.html' with { loader: 'text' };
// @ts-expect-error: imported as text, see text-imports.d.ts
import ts from './rx-mutation-page.ts' with { loader: 'text' };

@Component({
  selector: 'app-rx-mutation-page',
  imports: [CodeBlock, RouterLink],
  templateUrl: './rx-mutation-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RxMutationPage {
  protected readonly code = { ts: ts as string, html };

  private readonly http = inject(HttpClient);

  // #region code
  protected readonly createUser = rxMutation<string, User, HttpErrorResponse>({
    mutationFn: (name) => this.http.post<User>('/api/users', { name }),
  });
  // #endregion
}
