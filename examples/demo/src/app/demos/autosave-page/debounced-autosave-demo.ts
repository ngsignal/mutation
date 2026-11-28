import { ChangeDetectionStrategy, Component } from '@angular/core';
import { mutation } from '@ngsignal/mutation';
import { ActivityLog } from '../../shared/activity-log';
import { createFakeDocumentServer } from '../../shared/fake-api';

@Component({
  selector: 'app-debounced-autosave-demo',
  imports: [ActivityLog],
  templateUrl: './debounced-autosave-demo.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DebouncedAutosaveDemo {
  protected readonly server = createFakeDocumentServer();

  // #region code
  // Pending from the keystroke, sent once typing pauses for 500 ms.
  protected readonly save = mutation<string, void>({
    concurrency: { mode: 'queue-latest', debounce: 500 },
    mutationFn: (content, abortSignal) => this.server.save({ docId: 'A', content }, abortSignal),
  });
  // #endregion
}
