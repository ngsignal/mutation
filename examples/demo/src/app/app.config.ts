import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { TitleStrategy, provideRouter } from '@angular/router';
import { fakeHttpBackend } from './shared/fake-http-backend';
import { SeoTitleStrategy } from './shared/seo-title-strategy';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),
    // Pages are pre-rendered: hydration reuses their markup instead of rendering it again.
    provideClientHydration(withEventReplay()),
    { provide: TitleStrategy, useClass: SeoTitleStrategy },
    // withXhr(): Angular 22's default fetch backend reports no upload progress.
    provideHttpClient(withXhr(), withInterceptors([fakeHttpBackend])),
  ],
};
