import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { mutation } from '@ngsignal/mutation';
import { User, createFakeUserServer } from '../../shared/fake-api';

@Component({
  selector: 'app-getting-started-page',
  imports: [JsonPipe, RouterLink],
  templateUrl: './getting-started-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GettingStartedPage {
  private readonly server = createFakeUserServer();

  protected readonly users = signal<User[]>(this.server.initialUsers());
  protected readonly panelOpen = signal(false);

  // Side effects declared with the mutation.
  protected readonly createUser = mutation<string, User, Error>({
    mutationFn: (name, abortSignal) => this.server.createUser(name, abortSignal),
    onSuccess: (user) => this.users.update((current) => [...current, user]),
    onSettled: () => this.panelOpen.set(false),
  });

  // No callbacks: the call site awaits mutate().
  protected readonly deleteUser = mutation<User, void, Error>({
    mutationFn: (user, abortSignal) => this.server.deleteUser(user, abortSignal),
  });

  protected async remove(user: User): Promise<void> {
    try {
      await this.deleteUser.mutate(user);
      this.users.update((current) => current.filter((u) => u.id !== user.id));
    } catch {
      // Shown through deleteUser.error().
    }
  }
}
