// Flat config. The rule set is deliberately small: TypeScript's own strict mode
// already catches most of what a linter would, so lint here is for the classes
// of mistake the compiler cannot see — a floating promise in a pipeline that
// runs unattended, an `any` that silently disables checking downstream, an
// unawaited async call inside a throttled loop.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'archive/**', 'test/fixtures/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      'no-console': 'off',
    },
  },
  {
    // Tests and one-off scripts assert against fixtures and print to stdout;
    // the unsafe-* rules fire constantly on JSON.parse results there and would
    // train us to ignore the linter rather than read it.
    //
    // They also need their own program: the project service resolves the nearest
    // `tsconfig.json`, which deliberately excludes `test/` and `scripts/`, so
    // without this every file here lints as "not found by the project service".
    files: ['test/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    // `node:test`'s `test()` returns a promise that the runner itself awaits.
    // The rule is here for unattended pipeline code, not for a suite that would
    // otherwise need `void` in front of every case.
    files: ['test/**/*.ts'],
    rules: { '@typescript-eslint/no-floating-promises': 'off' },
  },
  {
    // This file configures the linter and belongs to no tsconfig, so the
    // type-aware rules have no program for it. Must come last to win.
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
);
