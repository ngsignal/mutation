// Templates imported as text with `with { loader: 'text' }`, to show a demo's own code
// (shared/code-block.ts). A TypeScript file imported the same way needs `@ts-expect-error`:
// TypeScript resolves it as the module itself.
declare module '*.html' {
  const content: string;
  export default content;
}
