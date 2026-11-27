import { Routes } from '@angular/router';
import { CancellationPage } from './demos/cancellation-page/cancellation-page';
import { AutosavePage } from './demos/autosave-page/autosave-page';
import { ConcurrentPage } from './demos/concurrent-page/concurrent-page';
import { FormSubmitPage } from './demos/form-submit-page/form-submit-page';
import { GettingStartedPage } from './demos/getting-started-page/getting-started-page';
import { HttpMutationPage } from './demos/http-mutation-page/http-mutation-page';
import { HttpResponsesPage } from './demos/http-responses-page/http-responses-page';
import { ListsPage } from './demos/lists-page/lists-page';
import { NotFoundPage } from './demos/not-found-page/not-found-page';
import { RenameThenDeletePage } from './demos/rename-then-delete-page/rename-then-delete-page';
import { ResourcePage } from './demos/resource-page/resource-page';
import { RxMutationPage } from './demos/rx-mutation-page/rx-mutation-page';
import { SavePerDocumentPage } from './demos/save-per-document-page/save-per-document-page';
import { StatePage } from './demos/state-page/state-page';
import { WithoutMutationPage } from './demos/without-mutation-page/without-mutation-page';

/**
 * `title` is the page's heading; `data.description` its meta description, shown by search
 * engines and link previews (see `shared/seo-title-strategy.ts`). Keep it under ~155 characters.
 */
export const routes: Routes = [
  {
    path: '',
    component: GettingStartedPage,
    title: 'Getting started',
    data: {
      seoTitle: '@ngsignal/mutation: Signal-based mutations for Angular · Interactive demo',
      description:
        'Interactive demo of @ngsignal/mutation: run POST, PUT, PATCH and DELETE calls in Angular with mutation() and read status, value and error as signals.',
    },
  },
  {
    path: 'manual',
    component: WithoutMutationPage,
    title: 'Without mutation()',
    data: {
      description:
        'The same Angular writes without mutation(): state signals, a generation counter, AbortController, PendingTasks and DestroyRef cleanup written by hand.',
    },
  },
  {
    path: 'concurrent',
    component: ConcurrentPage,
    title: 'Concurrent calls',
    data: {
      description:
        "A second mutate() while a call is in flight: parallel by default, or queued, replaced or dropped with Angular mutation()'s concurrency option.",
    },
  },
  {
    path: 'state',
    component: StatePage,
    title: 'Reading state',
    data: {
      description:
        "Reading an Angular mutation's state as signals: status() and its flags, hasValue(), snapshot() for an exhaustive @switch, input() and a typed error().",
    },
  },
  // The concurrency modes moved to /concurrent (reference) and the use-case pages.
  { path: 'concurrency', redirectTo: 'concurrent' },
  {
    path: 'cancellation',
    component: CancellationPage,
    title: 'Cancellation and reset()',
    data: {
      description:
        'How reset() and destroying the component abort an Angular mutation in flight: the AbortSignal fires, no callback runs and mutate() rejects.',
    },
  },
  {
    path: 'resource',
    component: ResourcePage,
    title: 'Working with resource()',
    data: {
      description:
        'Keeping an Angular resource() up to date after a write with mutation(): reload it after success, or show the change at once from pendingInputs().',
    },
  },
  {
    path: 'form-submit',
    component: FormSubmitPage,
    title: 'Form submit',
    data: {
      description:
        "Saving an Angular form or paying: rxMutation() next to the hand-written Observable version, and concurrency: 'drop' against double submits.",
    },
  },
  {
    path: 'lists',
    component: ListsPage,
    title: 'Lists and bulk actions',
    data: {
      description:
        "One Angular mutation shared by every item of a list: pendingInputs() for progress, concurrency: 'queue' to reorder items in order.",
    },
  },
  {
    path: 'autosave',
    component: AutosavePage,
    title: 'Autosave',
    data: {
      description:
        "Autosaving an Angular document on every keystroke with mutation() and concurrency: 'queue-latest': saves stay in order, overtaken versions are skipped.",
    },
  },
  {
    path: 'rename-then-delete',
    component: RenameThenDeletePage,
    title: 'Rename, then delete',
    data: {
      description:
        'Ordering two different Angular mutations on the same data with a shared mutationQueue(): a delete waits for the rename sent before it.',
    },
  },
  {
    path: 'save-per-document',
    component: SavePerDocumentPage,
    title: 'Save per document',
    data: {
      description:
        'Saving several documents in Angular with mutationQueue() and { queue, key }: saves stay in order per document, other documents never wait.',
    },
  },
  {
    path: 'rx',
    component: RxMutationPage,
    title: 'rxMutation()',
    data: {
      description:
        'rxMutation(), the RxJS counterpart of rxResource() for writes: wrap an Observable such as http.post() and read its state as Angular signals.',
    },
  },
  {
    path: 'http',
    component: HttpMutationPage,
    title: 'httpMutation()',
    data: {
      description:
        'httpMutation(), the write counterpart of Angular httpResource(): send POST, PUT and DELETE through HttpClient with statusCode, headers and upload progress.',
    },
  },
  {
    path: 'http-responses',
    component: HttpResponsesPage,
    title: 'httpMutation(): response bodies',
    data: {
      description:
        'Reading response bodies with httpMutation(): validate them with parse, read blobs and text, and track download progress in Angular.',
    },
  },
  {
    path: '**',
    component: NotFoundPage,
    title: 'Page not found',
    data: { noindex: true },
  },
];
