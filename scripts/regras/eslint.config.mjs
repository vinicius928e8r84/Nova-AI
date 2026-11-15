const globaisDoNode = ['require', 'module', 'exports', '__dirname', '__filename', 'process', 'Buffer', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'structuredClone', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'AbortController', 'AbortSignal', 'fetch', 'FormData', 'Headers', 'Request', 'Response', 'Blob', 'performance', 'global', 'globalThis', 'WebAssembly', 'atob', 'btoa'];
const globaisDoNavegador = ['window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'history', 'screen', 'alert', 'confirm', 'prompt', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'Event', 'CustomEvent', 'HTMLElement', 'Element', 'Node', 'WebSocket', 'XMLHttpRequest', 'File', 'FileReader', 'MediaRecorder', 'MediaStream', 'AudioContext', 'Audio', 'Image', 'WebSocket', 'getComputedStyle', 'crypto', 'self', 'importScripts', 'caches', 'clients', 'chrome', 'indexedDB', 'DOMParser', 'OffscreenCanvas', 'speechSynthesis', 'SpeechSynthesisUtterance', 'webkitSpeechRecognition', 'SpeechRecognition', 'Notification', 'ServiceWorkerGlobalScope', 'registerProcessor', 'AudioWorkletProcessor', 'sampleRate', 'currentTime', 'KeyboardEvent', 'MouseEvent', 'ClipboardItem', 'postMessage', 'addEventListener', 'removeEventListener'];

const globais = Object.fromEntries([...globaisDoNode, ...globaisDoNavegador].map(nome => [nome, 'readonly']));

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

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/release/**', '**/reservas/**', '**/*.min.js'] },
  { files: ['**/*.js', '**/*.cjs'], languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: globais }, rules: regras },
  { files: ['**/*.mjs'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globais }, rules: regras },
];
