import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CodeBlock } from '../../shared/code-block';
import { Restartable } from '../../shared/restartable';
import { PayDemo } from './pay-demo';
// @ts-expect-error: imported as text, see text-imports.d.ts
import pay from './pay-demo.ts' with { loader: 'text' };
import { SaveDemo } from './save-demo';
// @ts-expect-error: imported as text, see text-imports.d.ts
import save from './save-demo.ts' with { loader: 'text' };

@Component({
  selector: 'app-form-submit-page',
  imports: [Restartable, SaveDemo, PayDemo, CodeBlock],
  templateUrl: './form-submit-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormSubmitPage {
  protected readonly code = { save: save as string, pay: pay as string };
}
