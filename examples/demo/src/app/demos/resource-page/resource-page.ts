import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Restartable } from '../../shared/restartable';
import { OptimisticDemo } from './optimistic-demo';
import { RefreshDemo } from './refresh-demo';

@Component({
  selector: 'app-resource-page',
  imports: [Restartable, RefreshDemo, OptimisticDemo],
  templateUrl: './resource-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResourcePage {}
