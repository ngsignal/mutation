import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { rxMutation } from '@ngsignal/mutation/rxjs-interop';
import { ActivityLog } from '../../shared/activity-log';
import { ApiError, Profile, createFakeProfileServer } from '../../shared/fake-api';

@Component({
  selector: 'app-save-demo',
  imports: [ActivityLog],
  templateUrl: './save-demo.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SaveDemo {
  private readonly destroyRef = inject(DestroyRef);

  // Hand-written: one signal per piece of state, a guard, and every branch resets the flag.
  protected readonly handWrittenServer = createFakeProfileServer();
  protected readonly isSaving = signal(false);
  protected readonly saveError = signal<ApiError | null>(null);
  protected readonly savedProfile = signal<Profile | null>(null);

  protected save(name: string): void {
    if (this.isSaving()) return;
    this.isSaving.set(true);
    this.saveError.set(null);
    this.handWrittenServer
      .saveProfile(name)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (profile) => {
          this.isSaving.set(false);
          this.savedProfile.set(profile);
        },
        error: (error: ApiError) => {
          this.isSaving.set(false);
          this.saveError.set(error);
        },
      });
  }

  // rxMutation(): the same behavior.
  protected readonly mutationServer = createFakeProfileServer();
  // #region code
  protected readonly saveProfile = rxMutation<string, Profile, ApiError>({
    concurrency: 'drop',
    mutationFn: (name) => this.mutationServer.saveProfile(name),
  });
  // #endregion

  protected submit(name: string): void {
    this.save(name);
    this.saveProfile.mutate(name);
  }
}
