import { ChangeDetectionStrategy, Component, resource } from '@angular/core';
import { mutation } from '@ngsignal/mutation';
import { User, createFakeUserServer } from '../../shared/fake-api';

@Component({
  selector: 'app-refresh-demo',
  templateUrl: './refresh-demo.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RefreshDemo {
  private readonly server = createFakeUserServer();

  protected readonly users = resource({
    loader: ({ abortSignal }) => this.server.fetchUsers(abortSignal),
    defaultValue: [],
  });

  protected readonly createUser = mutation<string, User, Error>({
    mutationFn: (name, abortSignal) => this.server.createUser(name, abortSignal),
    onSuccess: () => this.users.reload(),
  });
}
