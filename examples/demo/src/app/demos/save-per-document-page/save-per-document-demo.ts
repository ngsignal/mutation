import { ChangeDetectionStrategy, Component } from '@angular/core';
import { mutation, mutationQueue } from '@ngsignal/mutation';
import { ActivityLog } from '../../shared/activity-log';
import { Draft, createFakeDocumentServer } from '../../shared/fake-api';

@Component({
  selector: 'app-save-per-document-demo',
  imports: [ActivityLog],
  templateUrl: './save-per-document-demo.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SavePerDocumentDemo {
  protected readonly server = createFakeDocumentServer();
  private readonly documentWrites = mutationQueue();
  private edits = 0;

  protected readonly save = mutation<Draft, void, Error>({
    concurrency: { queue: this.documentWrites, key: (draft) => draft.docId },
    mutationFn: (draft, abortSignal) => this.server.save(draft, abortSignal),
  });

  // No key: waits for the saves of every document, and the saves made after it wait for it.
  protected readonly removeAll = mutation<void, void, Error>({
    concurrency: this.documentWrites,
    mutationFn: (_input, abortSignal) => this.server.removeAll(abortSignal),
  });

  protected edit(docId: Draft['docId']): void {
    this.save.mutate({ docId, content: `edit ${++this.edits}` });
  }
}
