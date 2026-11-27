import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

/**
 * A demo's own code, copyable: the `code` region(s) of a template or a TypeScript file imported as
 * text (`import source from './demo.html' with { loader: 'text' }`), marked with
 * `<!-- #region code -->` … `<!-- #endregion -->` or `// #region code` … `// #endregion`.
 * The code shown is the code that runs. Several regions with the same name are shown together.
 */
@Component({
  selector: 'app-code-block',
  template: `<div class="code-window">
    <button type="button" class="code-copy" aria-label="Copy code" (click)="copy()">
      @if (copied()) {
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
      } @else {
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="9" y="9" width="12" height="12" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      }
    </button>
    <span class="visually-hidden" role="status">{{ copied() ? 'Code copied' : '' }}</span>
    <pre tabindex="0"><code>@for (token of tokens(); track $index) {<span [class]="token.kind">{{ token.text }}</span>}</code></pre>
  </div>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeBlock {
  readonly source = input.required<string>();
  readonly region = input('code');

  private readonly extracted = computed(() => extractRegions(this.source(), this.region()));
  protected readonly tokens = computed(() => {
    const { code, isTemplate } = this.extracted();
    return isTemplate ? highlightTemplate(code) : highlightTypeScript(code);
  });
  protected readonly copied = signal(false);

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.extracted().code);
    } catch {
      return; // No clipboard (insecure context, permission denied): the code stays selectable.
    }
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2000);
  }
}

type TokenKind = '' | 'comment' | 'keyword' | 'tag' | 'attr' | 'string' | 'fn' | 'type' | 'punct';

interface Token {
  kind: TokenKind;
  text: string;
}

/** The regions called `name`, each without its common indentation, separated by a blank line. */
function extractRegions(source: string, name: string): { code: string; isTemplate: boolean } {
  const lines = source.split('\n');
  const isMarker = (line: string) => /#(end)?region\b/.test(line);
  const regions: string[] = [];
  let isTemplate = false;
  lines.forEach((line, start) => {
    if (!new RegExp(`#region ${name}\\b`).test(line)) {
      return;
    }
    isTemplate = line.includes('<!--');
    const end = lines.findIndex((other, index) => index > start && other.includes('#endregion'));
    const body = lines.slice(start + 1, end === -1 ? lines.length : end).filter((l) => !isMarker(l));
    const indent = Math.min(
      ...body.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length),
    );
    regions.push(body.map((l) => l.slice(indent)).join('\n'));
  });
  if (regions.length === 0) {
    // Fails the pre-rendering, so a renamed region can't ship an empty code block.
    throw new Error(`Code region "${name}" not found`);
  }
  return { code: regions.join('\n\n'), isTemplate };
}

const KEYWORDS = new Set(
  (
    'true false null undefined as typeof import from export const let new return if else this ' +
    'private protected public readonly async await void class extends implements function try catch'
  ).split(' '),
);

/** TypeScript: enough for these demos' code and template bindings. */
function highlightTypeScript(code: string): Token[] {
  const tokens: Token[] = [];
  const pattern =
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('[^']*'|"[^"]*"|`[^`]*`)|(@?[A-Za-z_$][\w$]*)(\s*\()?|(\?\?|\?\.|===|!==|=>|[=!<>]=?|[?:.,;|&()[\]{}+\-*/])|(\s+|.)/g;
  for (const match of code.matchAll(pattern)) {
    const [, comment, string, word, call, punct, other] = match;
    if (comment) {
      tokens.push({ kind: 'comment', text: comment });
    } else if (string) {
      tokens.push({ kind: 'string', text: string });
    } else if (word) {
      const kind = KEYWORDS.has(word) ? 'keyword' : call ? 'fn' : /^[A-Z]/.test(word) ? 'type' : '';
      tokens.push({ kind, text: word });
      if (call) {
        tokens.push(...highlightTypeScript(call));
      }
    } else if (punct) {
      tokens.push({ kind: 'punct', text: punct });
    } else {
      tokens.push({ kind: '', text: other });
    }
  }
  return tokens;
}

/** An Angular template: tags, attributes, bindings, interpolations and control flow blocks. */
function highlightTemplate(code: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const push = (kind: TokenKind, text: string) => text && tokens.push({ kind, text });

  while (i < code.length) {
    const rest = code.slice(i);
    let match: RegExpMatchArray | null;

    if ((match = rest.match(/^<!--[\s\S]*?-->/))) {
      push('comment', match[0]);
    } else if ((match = rest.match(/^\{\{([\s\S]*?)\}\}/))) {
      push('punct', '{{');
      tokens.push(...highlightTypeScript(match[1]));
      push('punct', '}}');
    } else if ((match = rest.match(/^@let\b([^;]*;)/))) {
      push('keyword', '@let');
      tokens.push(...highlightTypeScript(match[1]));
    } else if ((match = rest.match(/^@(else if|if|else|switch|case|default|for|empty)\b(\s*)/))) {
      push('keyword', `@${match[1]}`);
      push('', match[2]);
      const condition = code[i + match[0].length] === '(' ? balanced(code, i + match[0].length) : '';
      if (condition) {
        push('punct', '(');
        tokens.push(...highlightTypeScript(condition.slice(1, -1)));
        push('punct', ')');
      }
      i += match[0].length + condition.length;
      continue;
    } else if ((match = rest.match(/^<\/?[A-Za-z][\w-]*/))) {
      push('tag', match[0]);
      i += match[0].length;
      i = highlightAttributes(code, i, tokens);
      continue;
    } else if ((match = rest.match(/^[{}]/))) {
      push('punct', match[0]);
    } else {
      match = rest.match(/^[^<{}@]+|^./) as RegExpMatchArray;
      push('', match[0]);
    }
    i += match[0].length;
  }
  return tokens;
}

/** The attributes of a tag up to its `>`; returns the index after it. */
function highlightAttributes(code: string, start: number, tokens: Token[]): number {
  const pattern = /(\s+)|(\/?>)|([^\s=>/]+)(?:="([^"]*)")?/y;
  pattern.lastIndex = start;
  let index = start;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code))) {
    index = pattern.lastIndex;
    const [, space, end, name, value] = match;
    if (space) {
      tokens.push({ kind: '', text: space });
    } else if (end) {
      tokens.push({ kind: 'tag', text: end });
      break;
    } else {
      tokens.push({ kind: 'attr', text: name });
      if (value === undefined) {
        continue;
      }
      // A binding's value is an expression, a plain attribute's a string.
      if (/^[[(*]/.test(name)) {
        tokens.push({ kind: 'punct', text: '="' }, ...highlightTypeScript(value));
        tokens.push({ kind: 'punct', text: '"' });
      } else {
        tokens.push({ kind: 'punct', text: '=' }, { kind: 'string', text: `"${value}"` });
      }
    }
  }
  return index;
}

/** The parenthesized text starting at `start`, parentheses included. */
function balanced(code: string, start: number): string {
  let depth = 0;
  let quote = '';
  for (let i = start; i < code.length; i++) {
    const char = code[i];
    if (quote) {
      quote = char === quote ? '' : quote;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === '(') {
      depth++;
    } else if (char === ')' && --depth === 0) {
      return code.slice(start, i + 1);
    }
  }
  return '';
}
