import { ChangeDetectionStrategy, Component, computed, resource } from '@angular/core';
import { mutation } from '@ngsignal/mutation';
import { User, createFakeUserServer } from '../../shared/fake-api';

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

  protected readonly visibleUsers = computed(() => {
    const deleting = new Set(this.deleteUser.pendingInputs().map((user) => user.id));
    return this.users.value().filter((user) => !deleting.has(user.id));
  });
}
