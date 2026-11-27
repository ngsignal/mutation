import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CodeBlock } from '../../shared/code-block';
import { Restartable } from '../../shared/restartable';
import { RefreshDemo } from './refresh-demo';
import html from './refresh-demo.html' with { loader: 'text' };
// @ts-expect-error: imported as text, see text-imports.d.ts
import ts from './refresh-demo.ts' with { loader: 'text' };

@Component({
  selector: 'app-refresh-page',
  imports: [Restartable, RefreshDemo, CodeBlock, RouterLink],
  templateUrl: './refresh-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RefreshPage {
  protected readonly code = { ts: ts as string, html };
}
