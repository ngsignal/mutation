import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Restartable } from '../../shared/restartable';
import { MoveToTopDemo } from './move-to-top-demo';
import { SeatMapDemo } from './seat-map-demo';

@Component({
  selector: 'app-lists-page',
  imports: [Restartable, SeatMapDemo, MoveToTopDemo],
  templateUrl: './lists-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListsPage {}
