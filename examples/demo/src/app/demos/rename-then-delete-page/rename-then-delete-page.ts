import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CodeBlock } from '../../shared/code-block';
import { Restartable } from '../../shared/restartable';
import { RenameThenDeleteDemo } from './rename-then-delete-demo';
// @ts-expect-error: imported as text, see text-imports.d.ts
import ts from './rename-then-delete-demo.ts' with { loader: 'text' };

@Component({
  selector: 'app-rename-then-delete-page',
  imports: [Restartable, RenameThenDeleteDemo, CodeBlock],
  templateUrl: './rename-then-delete-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RenameThenDeletePage {
  protected readonly code = { ts: ts as string };
}
