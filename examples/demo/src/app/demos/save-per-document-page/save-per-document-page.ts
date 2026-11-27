import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Restartable } from '../../shared/restartable';
import { SavePerDocumentDemo } from './save-per-document-demo';

@Component({
  selector: 'app-save-per-document-page',
  imports: [Restartable, SavePerDocumentDemo],
  templateUrl: './save-per-document-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SavePerDocumentPage {}
