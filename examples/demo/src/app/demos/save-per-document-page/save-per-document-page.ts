import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CodeBlock } from '../../shared/code-block';
import { Restartable } from '../../shared/restartable';
import { SavePerDocumentDemo } from './save-per-document-demo';
// @ts-expect-error: imported as text, see text-imports.d.ts
import ts from './save-per-document-demo.ts' with { loader: 'text' };

@Component({
  selector: 'app-save-per-document-page',
  imports: [Restartable, SavePerDocumentDemo, CodeBlock, RouterLink],
  templateUrl: './save-per-document-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SavePerDocumentPage {
  protected readonly code = { ts: ts as string };
}
