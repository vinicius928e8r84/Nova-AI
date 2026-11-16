import { readFileSync } from 'node:fs';

const { nomes } = JSON.parse(readFileSync(new URL('./globais.json', import.meta.url), 'utf8'));
const globais = Object.fromEntries(nomes.map(nome => [nome, 'readonly']));

const regras = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
  'no-unreachable': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-else-if': 'error',
  'no-dupe-args': 'error',
  'no-duplicate-case': 'error',
  'no-func-assign': 'error',
  'no-self-assign': 'error',
  'no-unsafe-finally': 'error',
  'no-unsafe-negation': 'error',
  'no-cond-assign': ['error', 'except-parens'],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-ex-assign': 'error',
  'no-const-assign': 'error',
  'no-import-assign': 'error',
  'no-sparse-arrays': 'error',
  'no-useless-catch': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-throw-literal': 'error',
};

const opcoes = { noInlineConfig: true };

export default [
  {
    ignores: [
      '**/node_modules/**', 'app/dist/**', 'MAC/**/dist/**', 'MAC/**/reservas/**', 'backup-antes-traducao/**', 'MAC/**/backup-*/**',
      'MAC/**/fixtures/**', 'MAC/**/index-Dun7lr2S*.js', 'app/electron/pwa/marked.min.js',
    ],
  },
  { files: ['**/*.js', '**/*.cjs'], languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: globais }, linterOptions: opcoes, rules: regras },
  { files: ['**/*.mjs'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globais }, linterOptions: opcoes, rules: regras },
];
