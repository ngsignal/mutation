import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { rxMutation } from '@ngsignal/mutation/rxjs-interop';
import { ActivityLog } from '../../shared/activity-log';
import { createFakeSeatServer } from '../../shared/fake-api';

@Component({
  selector: 'app-seat-map-demo',
  imports: [ActivityLog],
  templateUrl: './seat-map-demo.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeatMapDemo {
  private readonly destroyRef = inject(DestroyRef);

  // Hand-written: the list of seats in flight is kept by hand, and every branch must update it.
  protected readonly handWrittenServer = createFakeSeatServer();
  protected readonly handWrittenLocked = signal<number[]>([]);
  protected readonly handWrittenRefused = signal<number[]>([]);
  protected readonly lockingSeats = signal<number[]>([]);

  protected lockHandWritten(seat: number): void {
    this.lockingSeats.update((seats) => [...seats, seat]);
    this.handWrittenServer
      .lockSeat(seat)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.lockingSeats.update((seats) => seats.filter((other) => other !== seat));
          this.handWrittenLocked.update((seats) => [...seats, seat]);
        },
        error: () => {
          this.lockingSeats.update((seats) => seats.filter((other) => other !== seat));
          this.handWrittenRefused.update((seats) => [...seats, seat]);
        },
      });
  }

  // rxMutation(): pendingInputs() lists the seats whose call is still in flight.
  protected readonly mutationServer = createFakeSeatServer();
  protected readonly mutationLocked = signal<number[]>([]);
  protected readonly mutationRefused = signal<number[]>([]);
  protected readonly lockSeat = rxMutation<number, number>({
    mutationFn: (seat) => this.mutationServer.lockSeat(seat),
    onSuccess: (seat) => this.mutationLocked.update((seats) => [...seats, seat]),
    onError: (_error, seat) => this.mutationRefused.update((seats) => [...seats, seat]),
  });
}
