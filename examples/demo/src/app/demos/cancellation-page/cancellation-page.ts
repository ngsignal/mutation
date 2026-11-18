import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Restartable } from '../../shared/restartable';
import { DestroyDemo } from './destroy-demo';
import { QueuedResetDemo } from './queued-reset-demo';
import { ResetDemo } from './reset-demo';

@Component({
  selector: 'app-cancellation-page',
  imports: [Restartable, ResetDemo, QueuedResetDemo, DestroyDemo],
  templateUrl: './cancellation-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CancellationPage {}
