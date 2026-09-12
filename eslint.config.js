// @ts-check
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.spec.json',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Decorator',
          message:
            'No decorators allowed: this package is built with plain tsc (no ng-packagr/Ivy linker). ' +
            'A decorator (@Injectable, @Directive, etc.) would silently produce a broken package for consumers. ' +
            'See CONTRIBUTING.md.',
        },
      ],
    },
  },
];
