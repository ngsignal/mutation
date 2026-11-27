import { DOCUMENT, Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRouteSnapshot, RouterStateSnapshot, TitleStrategy } from '@angular/router';

/** Where GitHub Pages serves the demo. Canonical URLs end with "/": the pre-rendered folders. */
export const SITE_URL = 'https://ngsignal.github.io/mutation/';

const SITE_NAME = '@ngsignal/mutation demo';

/**
 * Sets what search engines and link previews read for each page, from its route: the document
 * title, the meta description, the canonical URL and the Open Graph tags. Pages are pre-rendered,
 * so these values are already in the HTML GitHub Pages serves.
 *
 * Route `data`: `description` (required for an indexed page), `seoTitle` (replaces
 * "<title> · @ngsignal/mutation demo"), `noindex` (the not-found page).
 */
@Injectable({ providedIn: 'root' })
export class SeoTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    let route: ActivatedRouteSnapshot = snapshot.root;
    while (route.firstChild) {
      route = route.firstChild;
    }
    const data = route.data;

    const title: string = data['seoTitle'] ?? `${this.buildTitle(snapshot)} · ${SITE_NAME}`;
    this.title.setTitle(title);
    this.meta.updateTag({ property: 'og:title', content: title });

    if (data['noindex']) {
      this.meta.updateTag({ name: 'robots', content: 'noindex' });
      this.setCanonical(null);
      return;
    }
    this.meta.removeTag('name="robots"');

    const description: string = data['description'];
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ property: 'og:description', content: description });

    const path = snapshot.url.split(/[?#]/)[0].replace(/^\/+|\/+$/g, '');
    const url = path ? `${SITE_URL}${path}/` : SITE_URL;
    this.meta.updateTag({ property: 'og:url', content: url });
    this.setCanonical(url);
  }

  private setCanonical(url: string | null): void {
    let link = this.document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (url === null) {
      link?.remove();
      return;
    }
    if (!link) {
      link = this.document.createElement('link');
      link.rel = 'canonical';
      this.document.head.appendChild(link);
    }
    link.href = url;
  }
}
