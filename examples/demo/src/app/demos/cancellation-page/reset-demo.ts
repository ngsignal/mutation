import { ChangeDetectionStrategy, Component } from '@angular/core';
import { mutation } from '@ngsignal/mutation';
import { ActivityLog, createActivityLog } from '../../shared/activity-log';
import { User, createFakeUserServer } from '../../shared/fake-api';

@Component({
  selector: 'app-reset-demo',
  imports: [ActivityLog],
  templateUrl: './reset-demo.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResetDemo {
  protected readonly server = createFakeUserServer();
  protected readonly log = createActivityLog();

  protected readonly createUser = mutation<string, User, Error>({
    mutationFn: (name, abortSignal) => this.server.createUser(name, abortSignal),
    onSuccess: (user) => this.log.add(`onSuccess("${user.name}")`),
  });

  protected create(name: string): void {
    this.createUser
      .mutate(name)
      .catch((error: Error) => this.log.add(`mutate("${name}") rejected: '${error.message}'`));
  }
}
