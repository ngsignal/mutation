import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Restartable } from '../../shared/restartable';
import { SaveDemo } from './save-demo';

@Component({
  selector: 'app-form-submit-page',
  imports: [Restartable, SaveDemo],
  templateUrl: './form-submit-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormSubmitPage {}
