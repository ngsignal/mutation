import { ChangeDetectionStrategy, Component } from '@angular/core';
import { mutation } from '@ngsignal/mutation';
import { ActivityLog } from '../../shared/activity-log';
import { createFakeDocumentServer } from '../../shared/fake-api';

@Component({
  selector: 'app-queue-latest-demo',
  imports: [ActivityLog],
  templateUrl: './queue-latest-demo.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QueueLatestDemo {
  protected readonly queuedServer = createFakeDocumentServer();
  protected readonly latestServer = createFakeDocumentServer();

  protected readonly saveQueued = mutation<string, void>({
    concurrency: 'queue',
    mutationFn: (content, abortSignal) => this.queuedServer.save({ docId: 'A', content }, abortSignal),
  });

  // Each call carries the whole document: a replaced call loses nothing.
  protected readonly saveLatest = mutation<string, void>({
    concurrency: 'queue-latest',
    mutationFn: (content, abortSignal) => this.latestServer.save({ docId: 'A', content }, abortSignal),
  });

  protected autosave(content: string): void {
    this.saveQueued.mutate(content);
    this.saveLatest.mutate(content);
  }
}
