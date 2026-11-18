import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PendingTasks,
  computed,
  inject,
  signal,
} from '@angular/core';
import { JsonPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { User, createFakeUserServer } from '../../shared/fake-api';

type Status = 'idle' | 'pending' | 'success' | 'error';

/**
 * The getting-started page without mutation(): per write, status/value/error/input signals, a
 * generation counter so only the latest call writes them, an AbortController per call aborted by
 * reset and destroy, and PendingTasks for SSR.
 */
@Component({
  selector: 'app-without-mutation-page',
  imports: [JsonPipe, RouterLink],
  templateUrl: './without-mutation-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WithoutMutationPage {
  private readonly server = createFakeUserServer();
  private readonly pendingTasks = inject(PendingTasks);

  protected readonly users = signal<User[]>(this.server.initialUsers());
  protected readonly panelOpen = signal(false);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.resetCreateUser();
      this.resetDeleteUser();
    });
  }

  protected readonly createUserStatus = signal<Status>('idle');
  protected readonly createUserValue = signal<User | undefined>(undefined);
  protected readonly createUserError = signal<Error | undefined>(undefined);
  protected readonly createUserInput = signal<string | undefined>(undefined);
  protected readonly createUserIsPending = computed(() => this.createUserStatus() === 'pending');
  private createUserGeneration = 0;
  private readonly createUserControllers = new Set<AbortController>();

  protected async createUser(name: string): Promise<void> {
    const generation = ++this.createUserGeneration;
    const controller = new AbortController();
    this.createUserControllers.add(controller);
    const removeTask = this.pendingTasks.add();
    this.createUserStatus.set('pending');
    this.createUserError.set(undefined);
    this.createUserInput.set(name);

    try {
      const user = await this.server.createUser(name, controller.signal);
      if (controller.signal.aborted) return;
      this.users.update((current) => [...current, user]);
      if (generation !== this.createUserGeneration) return;
      this.createUserValue.set(user);
      this.createUserStatus.set('success');
    } catch (error) {
      if (controller.signal.aborted || generation !== this.createUserGeneration) return;
      this.createUserError.set(error as Error);
      this.createUserStatus.set('error');
    } finally {
      removeTask();
      this.createUserControllers.delete(controller);
      if (!controller.signal.aborted) this.panelOpen.set(false);
    }
  }

  protected resetCreateUser(): void {
    this.createUserGeneration++;
    for (const controller of this.createUserControllers) controller.abort();
    this.createUserStatus.set('idle');
    this.createUserValue.set(undefined);
    this.createUserError.set(undefined);
    this.createUserInput.set(undefined);
  }

  protected readonly deleteUserStatus = signal<Status>('idle');
  protected readonly deleteUserError = signal<Error | undefined>(undefined);
  protected readonly deleteUserInput = signal<User | undefined>(undefined);
  protected readonly deleteUserIsPending = computed(() => this.deleteUserStatus() === 'pending');
  private deleteUserGeneration = 0;
  private readonly deleteUserControllers = new Set<AbortController>();

  protected async remove(user: User): Promise<void> {
    const generation = ++this.deleteUserGeneration;
    const controller = new AbortController();
    this.deleteUserControllers.add(controller);
    const removeTask = this.pendingTasks.add();
    this.deleteUserStatus.set('pending');
    this.deleteUserError.set(undefined);
    this.deleteUserInput.set(user);

    try {
      await this.server.deleteUser(user, controller.signal);
      if (controller.signal.aborted) return;
      this.users.update((current) => current.filter((u) => u.id !== user.id));
      if (generation === this.deleteUserGeneration) this.deleteUserStatus.set('success');
    } catch (error) {
      if (controller.signal.aborted || generation !== this.deleteUserGeneration) return;
      this.deleteUserError.set(error as Error);
      this.deleteUserStatus.set('error');
    } finally {
      removeTask();
      this.deleteUserControllers.delete(controller);
    }
  }

  protected resetDeleteUser(): void {
    this.deleteUserGeneration++;
    for (const controller of this.deleteUserControllers) controller.abort();
    this.deleteUserStatus.set('idle');
    this.deleteUserError.set(undefined);
    this.deleteUserInput.set(undefined);
  }
}
