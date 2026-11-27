import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CodeBlock } from '../../shared/code-block';
import { Restartable } from '../../shared/restartable';
import { OptimisticDemo } from './optimistic-demo';
import html from './optimistic-demo.html' with { loader: 'text' };
// @ts-expect-error: imported as text, see text-imports.d.ts
import ts from './optimistic-demo.ts' with { loader: 'text' };

@Component({
  selector: 'app-optimistic-page',
  imports: [Restartable, OptimisticDemo, CodeBlock],
  templateUrl: './optimistic-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptimisticPage {
  protected readonly code = { ts: ts as string, html };
}
