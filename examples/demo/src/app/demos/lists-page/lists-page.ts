import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CodeBlock } from '../../shared/code-block';
import { Restartable } from '../../shared/restartable';
import { MoveToTopDemo } from './move-to-top-demo';
// @ts-expect-error: imported as text, see text-imports.d.ts
import moveTs from './move-to-top-demo.ts' with { loader: 'text' };
import { SeatMapDemo } from './seat-map-demo';
import seatsHtml from './seat-map-demo.html' with { loader: 'text' };
// @ts-expect-error: imported as text, see text-imports.d.ts
import seatsTs from './seat-map-demo.ts' with { loader: 'text' };

@Component({
  selector: 'app-lists-page',
  imports: [Restartable, SeatMapDemo, MoveToTopDemo, CodeBlock, RouterLink],
  templateUrl: './lists-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListsPage {
  protected readonly code = {
    seatsTs: seatsTs as string,
    seatsHtml,
    moveTs: moveTs as string,
  };
}
