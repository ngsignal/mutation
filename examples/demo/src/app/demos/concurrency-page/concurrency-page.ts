import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Restartable } from '../../shared/restartable';
import { DropDemo } from './drop-demo';
import { KeyedQueueDemo } from './keyed-queue-demo';
import { QueueDemo } from './queue-demo';
import { SharedQueueDemo } from './shared-queue-demo';

@Component({
  selector: 'app-concurrency-page',
  imports: [Restartable, QueueDemo, DropDemo, SharedQueueDemo, KeyedQueueDemo],
  templateUrl: './concurrency-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConcurrencyPage {}
