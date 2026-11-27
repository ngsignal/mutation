import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { mutation } from '@ngsignal/mutation';
import { CodeBlock } from '../../shared/code-block';
import { ApiError, User, createFakeUserServer } from '../../shared/fake-api';
import template from './state-page.html' with { loader: 'text' };
// @ts-expect-error: imported as text, see text-imports.d.ts
import ts from './state-page.ts' with { loader: 'text' };

@Component({
  selector: 'app-state-page',
  imports: [CodeBlock],
  templateUrl: './state-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatePage {
  /** This page's template, shown region by region next to what it renders. */
  protected readonly template = template;
  protected readonly ts = ts as string;
  protected readonly server = createFakeUserServer();

  // #region create
  // TError types error() and onError; mutation() does not check it at runtime.
  protected readonly createUser = mutation<string, User, ApiError>({
    mutationFn: (name, abortSignal) => this.server.createUser(name, abortSignal),
  });
  // #endregion

  protected readonly lastCreatedName = computed(() =>
    this.createUser.hasValue() ? this.createUser.value().name : undefined,
  );

  protected retry(): void {
    const name = this.createUser.input();
    if (name !== undefined) {
      this.createUser.mutate(name);
    }
  }
}
