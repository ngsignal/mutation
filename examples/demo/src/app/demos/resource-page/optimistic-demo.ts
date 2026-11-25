import { ChangeDetectionStrategy, Component, computed, resource } from '@angular/core';
import { mutation } from '@ngsignal/mutation';
import { User, createFakeUserServer } from '../../shared/fake-api';

/** What the server does on a rename, applied to a list: pure, testable without Angular. */
const rename = (users: User[], { id, name }: User) => users.map((u) => (u.id === id ? { ...u, name } : u));

@Component({
  selector: 'app-optimistic-demo',
  templateUrl: './optimistic-demo.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptimisticDemo {
  private readonly server = createFakeUserServer();

  protected readonly users = resource({
    loader: ({ abortSignal }) => this.server.fetchUsers(abortSignal),
    defaultValue: [],
  });

  protected readonly deleteUser = mutation<User, void, Error>({
    mutationFn: (user, abortSignal) => this.server.deleteUser(user, abortSignal),
    onSuccess: (_output, user) => this.users.update((users) => users.filter((u) => u.id !== user.id)),
  });

  protected readonly renameUser = mutation<User, User, Error>({
    mutationFn: (user, abortSignal) => this.server.renameUser(user, abortSignal),
    onSuccess: (renamed) => this.users.update((users) => rename(users, renamed)),
    concurrency: 'queue',
  });

  protected readonly visibleUsers = computed(() => {
    const deleting = new Set(this.deleteUser.pendingInputs().map((user) => user.id));
    const renamed = this.renameUser.pendingInputs().reduce(rename, this.users.value());
    return renamed.filter((user) => !deleting.has(user.id));
  });
}
