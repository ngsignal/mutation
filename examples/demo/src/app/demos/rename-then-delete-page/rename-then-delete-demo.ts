import { ChangeDetectionStrategy, Component } from '@angular/core';
import { mutation, mutationQueue } from '@ngsignal/mutation';
import { ActivityLog } from '../../shared/activity-log';
import { createFakeTodoServer } from '../../shared/fake-api';

@Component({
  selector: 'app-rename-then-delete-demo',
  imports: [ActivityLog],
  templateUrl: './rename-then-delete-demo.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RenameThenDeleteDemo {
  protected readonly parallelServer = createFakeTodoServer();
  protected readonly queuedServer = createFakeTodoServer();

  protected readonly renameParallel = mutation<string, string, Error>({
    mutationFn: (title, abortSignal) => this.parallelServer.rename(title, abortSignal),
  });
  protected readonly removeParallel = mutation<void, void, Error>({
    mutationFn: (_input, abortSignal) => this.parallelServer.remove(abortSignal),
  });

  // In an app, create it in a root service so that every component writing todos shares it.
  private readonly todoWrites = mutationQueue();

  protected readonly renameQueued = mutation<string, string, Error>({
    concurrency: this.todoWrites,
    mutationFn: (title, abortSignal) => this.queuedServer.rename(title, abortSignal),
  });
  protected readonly removeQueued = mutation<void, void, Error>({
    concurrency: this.todoWrites,
    mutationFn: (_input, abortSignal) => this.queuedServer.remove(abortSignal),
  });

  protected rename(title: string): void {
    this.renameParallel.mutate(title);
    this.renameQueued.mutate(title);
  }

  protected remove(): void {
    this.removeParallel.mutate();
    this.removeQueued.mutate();
  }
}
