/**
 * Theme selection, shared by both apps.
 *
 * Three states, not two: 'system' follows the OS and is the default, and 'light'/'dark'
 * are explicit overrides the person chose. Collapsing this to a boolean would lose the
 * difference between "wants light" and "hasn't said", and a shopper whose phone flips to
 * dark at sunset would be stuck with whatever the app guessed at install time.
 */
export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'snapup-theme';

/**
 * Runs before first paint, inlined into <head>.
 *
 * Without this the page renders light, then swaps once React hydrates — a white flash in
 * a dark room, on every navigation. Written as a string of ES5 in a try/catch because it
 * executes before any bundle, and a throw here would leave the document unstyled.
 */
export const THEME_INIT_SCRIPT = `(function(){try{
var stored=localStorage.getItem('${THEME_STORAGE_KEY}');
var dark=stored==='dark'||((!stored||stored==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.setAttribute('data-theme',dark?'dark':'light');
}catch(e){}})();`;

export function readPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

export function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? systemTheme() : preference;
}

/** Writes the attribute the CSS variables key off, and persists the choice. */
export function applyPreference(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  document.documentElement.setAttribute('data-theme', resolved);

  if (preference === 'system') {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
  } else {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  }

  return resolved;
}
