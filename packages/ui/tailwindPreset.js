const plugin = require('tailwindcss/plugin');
const { colors, cssVariables, palettes } = require('./theme');

/**
 * The Tailwind preset both apps share.
 *
 * It carries the colour scale, the shared radii and shadows, and — the part that makes
 * theming work — a base layer that declares the light variables on `:root` and the dark
 * ones on `[data-theme="dark"]`. The theme is therefore chosen by a single attribute on
 * <html>, which is what the no-flash script sets before first paint.
 *
 * `prefers-color-scheme` is honoured through that same attribute rather than a media
 * query, so an explicit choice by the customer can override the OS setting instead of
 * fighting it.
 */
const themeVariables = plugin(({ addBase }) => {
  addBase({
    ':root': {
      ...cssVariables(palettes.light),
      colorScheme: 'light',
      '--shadow-card': '0 1px 2px rgb(16 24 40 / 0.05), 0 10px 24px -14px rgb(16 24 40 / 0.22)',
      '--shadow-pop': '0 2px 6px rgb(16 24 40 / 0.08), 0 24px 48px -20px rgb(16 24 40 / 0.35)',
    },
    '[data-theme="dark"]': {
      ...cssVariables(palettes.dark),
      colorScheme: 'dark',
      // A dark surface on a dark page needs the shadow to do more work, so it is both
      // deeper and larger than its light counterpart rather than the same value reused.
      '--shadow-card': '0 1px 2px rgb(0 0 0 / 0.5), 0 12px 28px -16px rgb(0 0 0 / 0.8)',
      '--shadow-pop': '0 2px 8px rgb(0 0 0 / 0.6), 0 28px 56px -24px rgb(0 0 0 / 0.9)',
    },
  });
});

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors,
      borderRadius: {
        xl2: '32px',
      },
      boxShadow: {
        /** Resting elevation for cards. Deeper in dark, where a soft shadow disappears. */
        card: 'var(--shadow-card)',
        /** Modals, toasts and anything that floats above the page. */
        pop: 'var(--shadow-pop)',
      },
      transitionTimingFunction: {
        snap: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        /**
         * A band of light travelling across a placeholder.
         *
         * Preferred over a pulsing opacity for skeletons because it has a direction:
         * movement across the block reads as "content is arriving", where a fade in and
         * out reads as "something here is broken". It also keeps the placeholder's
         * contrast steady, so the layout does not appear to breathe.
         */
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        /** A sheet or toast arriving from the bottom edge. */
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        /** A count changing. Overshoots slightly so the eye catches it. */
        pop: {
          '0%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(1.18)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 220ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'scale-in': 'scale-in 160ms cubic-bezier(0.22, 1, 0.36, 1) both',
        shimmer: 'shimmer 1.6s infinite',
        'slide-up': 'slide-up 260ms cubic-bezier(0.22, 1, 0.36, 1) both',
        pop: 'pop 320ms cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [themeVariables],
};
