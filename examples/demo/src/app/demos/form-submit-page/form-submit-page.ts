import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Restartable } from '../../shared/restartable';
import { PayDemo } from './pay-demo';
import { SaveDemo } from './save-demo';

@Component({
  selector: 'app-form-submit-page',
  imports: [Restartable, SaveDemo, PayDemo],
  templateUrl: './form-submit-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormSubmitPage {}
