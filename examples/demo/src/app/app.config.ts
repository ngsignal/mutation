import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { fakeHttpBackend } from './shared/fake-http-backend';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),
    // withXhr(): Angular 22's default fetch backend reports no upload progress.
    provideHttpClient(withXhr(), withInterceptors([fakeHttpBackend])),
  ],
};
