import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EnvironmentInjector,
  createEnvironmentInjector,
  inject,
  signal,
} from '@angular/core';
import { mutation } from '@ngsignal/mutation';
import { ActivityLog, createActivityLog } from '../../shared/activity-log';
import { User, createFakeUserServer } from '../../shared/fake-api';

@Component({
  selector: 'app-destroy-demo',
  imports: [ActivityLog],
  templateUrl: './destroy-demo.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DestroyDemo {
  protected readonly server = createFakeUserServer();
  protected readonly log = createActivityLog();
  // #region code
  private readonly childInjector = createEnvironmentInjector([], inject(EnvironmentInjector));
  protected readonly destroyed = signal(false);

  protected readonly createUser = mutation<string, User, Error>({
    injector: this.childInjector,
    mutationFn: (name, abortSignal) => this.server.createUser(name, abortSignal),
    onSuccess: (user) => this.log.add(`onSuccess("${user.name}")`),
  });
  // #endregion

  constructor() {
    inject(DestroyRef).onDestroy(() => this.destroyChildInjector());
  }

  protected create(name: string): void {
    this.createUser
      .mutate(name)
      .catch((error: Error) => this.log.add(`mutate("${name}") rejected: '${error.message}'`));
  }

  protected destroyChildInjector(): void {
    if (!this.destroyed()) {
      this.childInjector.destroy();
      this.destroyed.set(true);
    }
  }
}
