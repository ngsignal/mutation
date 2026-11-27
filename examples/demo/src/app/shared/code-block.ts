import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * A code window. `source` + `region` shows a region of a page's own template, imported as text
 * (`import template from './page.html' with { loader: 'text' }`) and marked with
 * `<!-- #region name -->` … `<!-- #endregion -->`: the code shown is the code that runs.
 * `code` shows a TypeScript snippet as is.
 */
@Component({
  selector: 'app-code-block',
  template: `<figure class="code-window">
    <figcaption>
      <span class="code-window-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      {{ filename() }}
    </figcaption>
    <pre tabindex="0"><code>@for (token of tokens(); track $index) {<span [class]="token.kind">{{ token.text }}</span>}</code></pre>
  </figure>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeBlock {
  readonly filename = input.required<string>();
  readonly source = input<string>();
  readonly region = input<string>();
  readonly code = input<string>();

  protected readonly tokens = computed(() => {
    const code = this.code();
    if (code !== undefined) {
      return highlightTypeScript(code.trim());
    }
    return highlightTemplate(extractRegion(this.source() ?? '', this.region() ?? ''));
  });
}

type TokenKind = '' | 'comment' | 'keyword' | 'tag' | 'attr' | 'string' | 'fn' | 'type' | 'punct';

interface Token {
  kind: TokenKind;
  text: string;
}

/** The lines between `#region name` and `#endregion`, without their common indentation. */
function extractRegion(source: string, name: string): string {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.includes(`#region ${name} `));
  const end = lines.findIndex((line, index) => index > start && line.includes('#endregion'));
  if (start === -1 || end === -1) {
    // Fails the pre-rendering, so a renamed region can't ship an empty code block.
    throw new Error(`Code region "${name}" not found`);
  }
  const body = lines.slice(start + 1, end);
  const indent = Math.min(
    ...body.filter((line) => line.trim()).map((line) => line.length - line.trimStart().length),
  );
  return body.map((line) => line.slice(indent)).join('\n');
}

const KEYWORDS = new Set(['true', 'false', 'null', 'undefined', 'as', 'typeof', 'type', 'const']);

/** A TypeScript expression or type: enough for template bindings and short snippets. */
function highlightTypeScript(code: string): Token[] {
  const tokens: Token[] = [];
  const pattern =
    /(\/\/[^\n]*)|('[^']*'|"[^"]*"|`[^`]*`)|([A-Za-z_$][\w$]*)(\s*\()?|(\?\?|\?\.|===|!==|=>|[=!<>]=?|[?:.,;|&()[\]{}+\-*/])|(\s+|.)/g;
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
