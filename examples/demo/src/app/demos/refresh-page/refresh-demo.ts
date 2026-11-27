import { ChangeDetectionStrategy, Component, resource } from '@angular/core';
import { mutation } from '@ngsignal/mutation';
import { ActivityLog } from '../../shared/activity-log';
import { User, createFakeUserServer } from '../../shared/fake-api';

@Component({
  selector: 'app-refresh-demo',
  imports: [ActivityLog],
  templateUrl: './refresh-demo.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RefreshDemo {
  protected readonly server = createFakeUserServer();

  // #region code
  protected readonly users = resource({
    loader: ({ abortSignal }) => this.server.fetchUsers(abortSignal),
    defaultValue: [],
  });

  protected readonly createUser = mutation<string, User, Error>({
    mutationFn: (name, abortSignal) => this.server.createUser(name, abortSignal),
    onSuccess: () => this.users.reload(),
  });
  // #endregion
}
