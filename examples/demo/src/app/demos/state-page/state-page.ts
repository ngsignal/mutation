import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { mutation } from '@ngsignal/mutation';
import { ApiError, User, createFakeUserServer } from '../../shared/fake-api';

@Component({
  selector: 'app-state-page',
  templateUrl: './state-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatePage {
  protected readonly server = createFakeUserServer();

  // TError types error() and onError; mutation() does not check it at runtime.
  protected readonly createUser = mutation<string, User, ApiError>({
    mutationFn: (name, abortSignal) => this.server.createUser(name, abortSignal),
  });

  protected readonly lastCreatedName = computed(() =>
    this.createUser.hasValue() ? this.createUser.value().name : undefined,
  );

  protected retry(): void {
    const name = this.createUser.input();
    if (name !== undefined) {
      this.createUser.mutate(name);
    }
  }
}
