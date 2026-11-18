import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { httpMutation } from '@ngsignal/mutation/http';
import { User } from '../../shared/fake-api';
import { UploadedAvatar } from '../../shared/fake-http-backend';

@Component({
  selector: 'app-http-mutation-page',
  imports: [DecimalPipe],
  templateUrl: './http-mutation-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HttpMutationPage {
  protected readonly createUser = httpMutation<string, User, HttpErrorResponse>({
    request: (name) => ({ method: 'POST', url: '/api/users', body: { name } }),
  });

  protected readonly uploadAvatar = httpMutation<File, UploadedAvatar, HttpErrorResponse>({
    request: (file) => {
      const body = new FormData();
      body.append('avatar', file);
      return { method: 'POST', url: '/api/avatar', body, reportProgress: true };
    },
  });

  protected upload(files: FileList | null): void {
    const file = files?.[0];
    if (file) this.uploadAvatar.mutate(file);
  }
}
