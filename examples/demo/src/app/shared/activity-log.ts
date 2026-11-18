import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';

export function createActivityLog() {
  const entries = signal<string[]>([]);

  return {
    entries: entries.asReadonly(),
    add(entry: string): void {
      const time = new Date().toLocaleTimeString();
      entries.update((list) => [`${time}: ${entry}`, ...list].slice(0, 12));
    },
    clear: () => entries.set([]),
  };
}

@Component({
  selector: 'app-activity-log',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="log">
      <h2>{{ heading() }}</h2>
      <ol>
        @for (entry of entries(); track $index) {
          <li>{{ entry }}</li>
        } @empty {
          <li class="hint">{{ emptyText() }}</li>
        }
      </ol>
    </section>
  `,
})
export class ActivityLog {
  readonly entries = input.required<string[]>();
  readonly heading = input('Activity log');
  readonly emptyText = input('Nothing yet.');
}
