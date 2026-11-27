import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { mutation } from '@ngsignal/mutation';
import { ActivityLog, createActivityLog } from '../../shared/activity-log';
import { User, createFakeUserServer } from '../../shared/fake-api';

@Component({
  selector: 'app-concurrent-page',
  imports: [ActivityLog, RouterLink],
  templateUrl: './concurrent-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConcurrentPage {
  protected readonly server = createFakeUserServer();
  protected readonly log = createActivityLog();
  protected readonly users = signal<User[]>(this.server.initialUsers());

  protected readonly createUser = mutation<string, User, Error>({
    mutationFn: (name, abortSignal) => this.server.createUser(name, abortSignal),
    onSuccess: (user, _name, { isLatest }) => {
      this.users.update((current) => [...current, user]);
      this.log.add(`createUser("${user.name}") succeeded, isLatest: ${isLatest}`);
    },
    onError: (error, name, { isLatest }) =>
      this.log.add(`createUser("${name}") failed: ${error.message}, isLatest: ${isLatest}`),
  });

  protected readonly deleteUser = mutation<User, void, Error>({
    mutationFn: (user, abortSignal) => this.server.deleteUser(user, abortSignal),
    onSuccess: (_result, user, { isLatest }) => {
      this.users.update((current) => current.filter((u) => u.id !== user.id));
      this.log.add(`deleteUser("${user.name}") succeeded, isLatest: ${isLatest}`);
    },
    onError: (error, user, { isLatest }) =>
      this.log.add(`deleteUser("${user.name}") failed: ${error.message}, isLatest: ${isLatest}`),
  });
}
