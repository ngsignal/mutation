import { ChangeDetectionStrategy, Component } from '@angular/core';
import { mutation } from '@ngsignal/mutation';
import { ActivityLog } from '../../shared/activity-log';
import { createFakeReorderServer } from '../../shared/fake-api';

@Component({
  selector: 'app-move-to-top-demo',
  imports: [ActivityLog],
  templateUrl: './move-to-top-demo.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MoveToTopDemo {
  protected readonly parallelServer = createFakeReorderServer();
  protected readonly queuedServer = createFakeReorderServer();

  protected readonly moveParallel = mutation<string, string[]>({
    mutationFn: (item, abortSignal) => this.parallelServer.moveToTop(item, abortSignal),
  });

  protected readonly moveQueued = mutation<string, string[]>({
    concurrency: 'queue',
    mutationFn: (item, abortSignal) => this.queuedServer.moveToTop(item, abortSignal),
  });

  protected moveToTop(item: string): void {
    this.moveParallel.mutate(item);
    this.moveQueued.mutate(item);
  }
}
