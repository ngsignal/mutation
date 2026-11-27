import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Restartable } from '../../shared/restartable';
import { AutosaveDemo } from './autosave-demo';

@Component({
  selector: 'app-autosave-page',
  imports: [Restartable, AutosaveDemo],
  templateUrl: './autosave-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AutosavePage {}
