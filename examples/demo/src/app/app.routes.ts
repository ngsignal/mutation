import { Routes } from '@angular/router';
import { CancellationPage } from './demos/cancellation-page/cancellation-page';
import { ConcurrencyPage } from './demos/concurrency-page/concurrency-page';
import { ConcurrentPage } from './demos/concurrent-page/concurrent-page';
import { FormSubmitPage } from './demos/form-submit-page/form-submit-page';
import { GettingStartedPage } from './demos/getting-started-page/getting-started-page';
import { HttpMutationPage } from './demos/http-mutation-page/http-mutation-page';
import { HttpResponsesPage } from './demos/http-responses-page/http-responses-page';
import { ListsPage } from './demos/lists-page/lists-page';
import { NotFoundPage } from './demos/not-found-page/not-found-page';
import { ResourcePage } from './demos/resource-page/resource-page';
import { RxMutationPage } from './demos/rx-mutation-page/rx-mutation-page';
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
        'What happens when mutate() is called again while a call is in flight: both calls complete, and only the latest one writes status, value and error.',
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
  {
    path: 'concurrency',
    component: ConcurrencyPage,
    title: "concurrency: 'queue', 'drop' and mutationQueue()",
    data: {
      description:
        "Ordering Angular writes: run calls in parallel, queue them with concurrency: 'queue' or 'queue-latest', drop them with 'drop', or share a mutationQueue().",
    },
  },
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
        "Saving an Angular form: the hand-written Observable version next to the same save with rxMutation() and concurrency: 'drop' against double submits.",
    },
  },
  {
    path: 'lists',
    component: ListsPage,
    title: 'Lists and bulk actions',
    data: {
      description:
        'One Angular mutation shared by every item of a list: pendingInputs() shows which items are being written and the progress of a bulk action.',
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
