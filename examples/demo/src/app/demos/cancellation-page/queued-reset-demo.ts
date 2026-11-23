import { ChangeDetectionStrategy, Component } from '@angular/core';
import { mutation, wasNeverSent } from '@ngsignal/mutation';
import { ActivityLog, createActivityLog } from '../../shared/activity-log';
import { User, createFakeUserServer } from '../../shared/fake-api';

@Component({
  selector: 'app-queued-reset-demo',
  imports: [ActivityLog],
  templateUrl: './queued-reset-demo.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QueuedResetDemo {
  protected readonly server = createFakeUserServer();
  protected readonly log = createActivityLog();

  protected readonly createUser = mutation<string, User, Error>({
    concurrency: 'queue',
    mutationFn: (name, abortSignal) => this.server.createUser(name, abortSignal),
  });

  protected createTwo(): void {
    for (const name of ['First', 'Second']) {
      this.createUser
        .mutate(name)
        .catch((error: Error) =>
          this.log.add(`mutate("${name}") rejected: '${error.message}', wasNeverSent: ${wasNeverSent(error)}`),
        );
    }
  }
}
