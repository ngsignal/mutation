import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CodeBlock } from '../../shared/code-block';
import { Restartable } from '../../shared/restartable';
import { DestroyDemo } from './destroy-demo';
// @ts-expect-error: imported as text, see text-imports.d.ts
import destroy from './destroy-demo.ts' with { loader: 'text' };
import { QueuedResetDemo } from './queued-reset-demo';
// @ts-expect-error: imported as text, see text-imports.d.ts
import queuedReset from './queued-reset-demo.ts' with { loader: 'text' };
import { ResetDemo } from './reset-demo';
import resetHtml from './reset-demo.html' with { loader: 'text' };
// @ts-expect-error: imported as text, see text-imports.d.ts
import reset from './reset-demo.ts' with { loader: 'text' };

@Component({
  selector: 'app-cancellation-page',
  imports: [Restartable, ResetDemo, QueuedResetDemo, DestroyDemo, CodeBlock],
  templateUrl: './cancellation-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CancellationPage {
  protected readonly code = {
    reset: reset as string,
    resetHtml,
    queuedReset: queuedReset as string,
    destroy: destroy as string,
  };
}
