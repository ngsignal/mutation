import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CodeBlock } from '../../shared/code-block';
import { Restartable } from '../../shared/restartable';
import { AutosaveDemo } from './autosave-demo';
import html from './autosave-demo.html' with { loader: 'text' };
// @ts-expect-error: imported as text, see text-imports.d.ts
import ts from './autosave-demo.ts' with { loader: 'text' };
import { DebouncedAutosaveDemo } from './debounced-autosave-demo';
// @ts-expect-error: imported as text, see text-imports.d.ts
import debounced from './debounced-autosave-demo.ts' with { loader: 'text' };

@Component({
  selector: 'app-autosave-page',
  imports: [Restartable, AutosaveDemo, DebouncedAutosaveDemo, CodeBlock],
  templateUrl: './autosave-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AutosavePage {
  protected readonly code = { ts: ts as string, html, debounced: debounced as string };
}
