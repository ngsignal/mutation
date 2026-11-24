import { PlatformLocation } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  isDevMode,
  LOCALE_ID,
  signal,
} from '@angular/core';
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
      { path: '/', label: $localize`Getting started`, api: 'mutation' },
      { path: '/manual', label: $localize`Without mutation()`, api: 'mutation' },
      { path: '/concurrent', label: $localize`Concurrent calls`, api: 'mutation' },
      { path: '/state', label: $localize`Reading state`, api: 'mutation' },
      { path: '/concurrency', label: "'queue', 'drop', mutationQueue()", api: 'mutation' },
      { path: '/cancellation', label: $localize`Cancellation and reset()`, api: 'mutation' },
      { path: '/resource', label: $localize`Working with resource()`, api: 'mutation' },
    ],
  },
  {
    heading: $localize`Use cases`,
    links: [
      { path: '/form-submit', label: $localize`Form submit` },
      { path: '/lists', label: $localize`Lists and bulk actions` },
    ],
  },
  {
    heading: $localize`Adapters`,
    links: [
      { path: '/rx', label: 'rxMutation()', api: 'rx' },
      { path: '/http', label: 'httpMutation()', api: 'http' },
      { path: '/http-responses', label: $localize`Response bodies`, api: 'http' },
    ],
  },
];

const NAV_LINKS = NAV_GROUPS.flatMap((group) => group.links);

/** Each language is its own build: English at the root of the site, French under fr/. */
const LANGUAGES = {
  en: { code: 'en', name: 'English', subPath: '' },
  fr: { code: 'fr', name: 'Français', subPath: 'fr/' },
} as const;

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

  private readonly language = inject(LOCALE_ID).startsWith('fr') ? LANGUAGES.fr : LANGUAGES.en;
  /** The base href without this language's sub-path, e.g. /mutation/ for /mutation/fr/. */
  private readonly siteRoot = inject(PlatformLocation)
    .getBaseHrefFromDOM()
    .slice(0, this.language.subPath ? -this.language.subPath.length : undefined);

  /** The same page in the other language. The dev server serves one language only: no switch there. */
  protected readonly otherLanguage = isDevMode()
    ? undefined
    : this.language === LANGUAGES.fr
      ? LANGUAGES.en
      : LANGUAGES.fr;

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

  protected readonly otherLanguageUrl = computed(
    () => this.siteRoot + (this.otherLanguage?.subPath ?? '') + this.navigation().path.slice(1),
  );

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
