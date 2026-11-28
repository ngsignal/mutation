import { ChangeDetectionStrategy, Component, computed, resource } from '@angular/core';
import { mutation } from '@ngsignal/mutation';
import { ActivityLog } from '../../shared/activity-log';
import { User, createFakeUserServer } from '../../shared/fake-api';

/** What the server does on a rename. */
const rename = (users: User[], { id, name }: User) => users.map((u) => (u.id === id ? { ...u, name } : u));

@Component({
  selector: 'app-optimistic-demo',
  imports: [ActivityLog],
  templateUrl: './optimistic-demo.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptimisticDemo {
  protected readonly server = createFakeUserServer();

  protected readonly users = resource({
    loader: ({ abortSignal }) => this.server.fetchUsers(abortSignal),
    defaultValue: [],
  });

  // #region code
  protected readonly deleteUser = mutation<User, void, Error>({
    mutationFn: (user, abortSignal) => this.server.deleteUser(user, abortSignal),
    onSuccess: (_output, user) => this.users.update((users) => users.filter((u) => u.id !== user.id)),
  });
  // #endregion

  // #region code
  protected readonly renameUser = mutation<User, User, Error>({
    mutationFn: (user, abortSignal) => this.server.renameUser(user, abortSignal),
    onSuccess: (renamed) => this.users.update((users) => rename(users, renamed)),
    concurrency: 'queue',
  });
  // #endregion

  // #region code
  protected readonly visibleUsers = computed(() => {
    const deleting = new Set(this.deleteUser.pendingInputs().map((user) => user.id));
    const renamed = this.renameUser.pendingInputs().reduce(rename, this.users.value());
    return renamed.filter((user) => !deleting.has(user.id));
  });
  // #endregion
}
