import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { mutation } from '@ngsignal/mutation';
import { createFakePaymentServer } from '../../shared/fake-api';

@Component({
  selector: 'app-pay-demo',
  templateUrl: './pay-demo.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PayDemo {
  protected readonly defaultServer = createFakePaymentServer();
  protected readonly droppingServer = createFakePaymentServer();
  protected readonly clicks = signal(0);

  protected readonly payDefault = mutation<void, void>({
    mutationFn: (_input, abortSignal) => this.defaultServer.charge(abortSignal),
  });

  protected readonly payDropping = mutation<void, void>({
    concurrency: 'drop',
    mutationFn: (_input, abortSignal) => this.droppingServer.charge(abortSignal),
  });

  protected pay(): void {
    this.clicks.update((count) => count + 1);
    this.payDefault.mutate();
    this.payDropping.mutate();
  }
}
