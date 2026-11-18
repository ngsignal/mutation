import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Restartable } from '../../shared/restartable';
import { DropDemo } from './drop-demo';
import { QueueDemo } from './queue-demo';

@Component({
  selector: 'app-concurrency-page',
  imports: [Restartable, QueueDemo, DropDemo],
  templateUrl: './concurrency-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConcurrencyPage {}
