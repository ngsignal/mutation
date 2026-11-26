import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Served by GitHub Pages as 404.html, with a 404 status, for any unknown path. */
@Component({
  selector: 'app-not-found-page',
  imports: [RouterLink],
  template: `
    <p class="pitch">
      This page doesn't exist. Start with the <a routerLink="/">getting-started demo</a>, or pick
      one in the menu.
    </p>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundPage {}
