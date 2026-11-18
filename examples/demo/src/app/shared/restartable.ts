import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  TemplateRef,
  contentChild,
  signal,
} from '@angular/core';

/**
 * Renders its `<ng-template>`, and "Restart" renders it again from scratch: the demo component
 * is destroyed (aborting its calls) and recreated with fresh mutations and a fresh fake server.
 */
@Component({
  selector: 'app-restartable',
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (run of [runs()]; track run) {
      <ng-container [ngTemplateOutlet]="demo()" />
    }
    <button type="button" (click)="runs.update((count) => count + 1)">Restart</button>
  `,
})
export class Restartable {
  protected readonly demo = contentChild.required(TemplateRef);
  protected readonly runs = signal(0);
}
