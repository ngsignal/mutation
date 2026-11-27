import { ChangeDetectionStrategy, Component } from '@angular/core';
import { mutation } from '@ngsignal/mutation';
import { ActivityLog } from '../../shared/activity-log';
import { createFakeDocumentServer } from '../../shared/fake-api';

@Component({
  selector: 'app-autosave-demo',
  imports: [ActivityLog],
  templateUrl: './autosave-demo.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AutosaveDemo {
  protected readonly server = createFakeDocumentServer();

  // Each call carries the whole document, so a replaced call loses nothing.
  protected readonly save = mutation<string, void>({
    concurrency: 'queue-latest',
    mutationFn: (content, abortSignal) => this.server.save({ docId: 'A', content }, abortSignal),
  });
}
