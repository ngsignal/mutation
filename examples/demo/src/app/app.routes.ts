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
  { path: '', component: GettingStartedPage, title: 'Getting started' },
  { path: 'manual', component: WithoutMutationPage, title: 'Without mutation()' },
  { path: 'concurrent', component: ConcurrentPage, title: 'Concurrent calls' },
  { path: 'state', component: StatePage, title: 'Reading state' },
  { path: 'concurrency', component: ConcurrencyPage, title: "concurrency: 'queue' and 'drop'" },
  { path: 'cancellation', component: CancellationPage, title: 'Cancellation and reset()' },
  { path: 'resource', component: ResourcePage, title: 'Working with resource()' },
  { path: 'form-submit', component: FormSubmitPage, title: 'Form submit' },
  { path: 'lists', component: ListsPage, title: 'Lists and bulk actions' },
  { path: 'rx', component: RxMutationPage, title: 'rxMutation()' },
  { path: 'http', component: HttpMutationPage, title: 'httpMutation()' },
  { path: 'http-responses', component: HttpResponsesPage, title: 'httpMutation(): response bodies' },
];
