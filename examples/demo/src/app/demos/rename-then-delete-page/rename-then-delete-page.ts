import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Restartable } from '../../shared/restartable';
import { RenameThenDeleteDemo } from './rename-then-delete-demo';

@Component({
  selector: 'app-rename-then-delete-page',
  imports: [Restartable, RenameThenDeleteDemo],
  templateUrl: './rename-then-delete-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RenameThenDeletePage {}
