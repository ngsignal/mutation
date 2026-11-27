import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { filter, map, startWith, tap } from 'rxjs';
import { version as libraryVersion } from '@ngsignal/mutation/package.json';

/** The API a demo is about: its page and menu link take that API's color, as on the social preview. */
type Api = 'mutation' | 'rx' | 'http';

interface NavLink {
  path: string;
  label: string;
  api?: Api;
}

/** The menu, in reading order: the previous and next links at the bottom of a page follow it. */
const NAV_GROUPS: readonly { heading: string; links: readonly NavLink[] }[] = [
  {
    heading: 'mutation()',
    links: [
      { path: '/', label: 'Getting started', api: 'mutation' },
      { path: '/manual', label: 'Without mutation()', api: 'mutation' },
      { path: '/concurrent', label: 'Concurrent calls', api: 'mutation' },
      { path: '/state', label: 'Reading state', api: 'mutation' },
      { path: '/cancellation', label: 'Cancellation and reset()', api: 'mutation' },
    ],
  },
  {
    heading: 'Use cases',
    links: [
      { path: '/form-submit', label: 'Form submit' },
      { path: '/lists', label: 'Lists and bulk actions' },
      { path: '/autosave', label: 'Autosave' },
      { path: '/rename-then-delete', label: 'Rename, then delete' },
      { path: '/save-per-document', label: 'Save per document' },
      { path: '/refresh', label: 'Refresh a resource()' },
      { path: '/optimistic', label: 'Optimistic update' },
    ],
  },
  {
    heading: 'Adapters',
    links: [
      { path: '/rx', label: 'rxMutation()', api: 'rx' },
      { path: '/http', label: 'httpMutation()', api: 'http' },
      { path: '/http-responses', label: 'Response bodies', api: 'http' },
    ],
  },
];

const NAV_LINKS = NAV_GROUPS.flatMap((group) => group.links);

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'menuOpen.set(false)' },
})
export class App {
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);

  protected readonly libraryVersion = libraryVersion;
  protected readonly navGroups = NAV_GROUPS;

  /** Only used on narrow screens, where the menu is collapsed behind a button. */
  protected readonly menuOpen = signal(false);

  private readonly navigation = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      tap(() => this.menuOpen.set(false)),
      startWith(null),
      map(() => {
        let route = this.activatedRoute;
        while (route.firstChild) {
          route = route.firstChild;
        }
        return { title: route.snapshot.title ?? '', path: this.router.url.split(/[?#]/)[0] };
      }),
    ),
    { initialValue: { title: '', path: '/' } },
  );

  protected readonly pageTitle = computed(() => this.navigation().title);

  private readonly pageIndex = computed(() =>
    NAV_LINKS.findIndex((link) => link.path === this.navigation().path),
  );
  protected readonly pageApi = computed(() => NAV_LINKS[this.pageIndex()]?.api);
  protected readonly previousPage = computed(() => NAV_LINKS[this.pageIndex() - 1]);
  protected readonly nextPage = computed(() => {
    const index = this.pageIndex();
    return index === -1 ? undefined : NAV_LINKS[index + 1];
  });
}
