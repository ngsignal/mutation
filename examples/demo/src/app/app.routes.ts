import { Routes } from '@angular/router';
import { CancellationPage } from './demos/cancellation-page/cancellation-page';
import { ConcurrencyPage } from './demos/concurrency-page/concurrency-page';
import { ConcurrentPage } from './demos/concurrent-page/concurrent-page';
import { FormSubmitPage } from './demos/form-submit-page/form-submit-page';
import { GettingStartedPage } from './demos/getting-started-page/getting-started-page';
import { HttpMutationPage } from './demos/http-mutation-page/http-mutation-page';
import { HttpResponsesPage } from './demos/http-responses-page/http-responses-page';
import { ListsPage } from './demos/lists-page/lists-page';
import { ResourcePage } from './demos/resource-page/resource-page';
import { RxMutationPage } from './demos/rx-mutation-page/rx-mutation-page';
import { StatePage } from './demos/state-page/state-page';
import { WithoutMutationPage } from './demos/without-mutation-page/without-mutation-page';

export const routes: Routes = [
  { path: '', component: GettingStartedPage, title: $localize`Getting started` },
  { path: 'manual', component: WithoutMutationPage, title: $localize`Without mutation()` },
  { path: 'concurrent', component: ConcurrentPage, title: $localize`Concurrent calls` },
  { path: 'state', component: StatePage, title: $localize`Reading state` },
  {
    path: 'concurrency',
    component: ConcurrencyPage,
    title: $localize`concurrency: 'queue', 'drop' and mutationQueue()`,
  },
  { path: 'cancellation', component: CancellationPage, title: $localize`Cancellation and reset()` },
  { path: 'resource', component: ResourcePage, title: $localize`Working with resource()` },
  { path: 'form-submit', component: FormSubmitPage, title: $localize`Form submit` },
  { path: 'lists', component: ListsPage, title: $localize`Lists and bulk actions` },
  { path: 'rx', component: RxMutationPage, title: 'rxMutation()' },
  { path: 'http', component: HttpMutationPage, title: 'httpMutation()' },
  { path: 'http-responses', component: HttpResponsesPage, title: $localize`httpMutation(): response bodies` },
];
