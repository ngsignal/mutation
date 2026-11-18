import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { rxMutation } from '@ngsignal/mutation/rxjs-interop';
import { User } from '../../shared/fake-api';

@Component({
  selector: 'app-rx-mutation-page',
  templateUrl: './rx-mutation-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RxMutationPage {
  private readonly http = inject(HttpClient);

  protected readonly createUser = rxMutation<string, User, HttpErrorResponse>({
    mutationFn: (name) => this.http.post<User>('/api/users', { name }),
  });
}
