/**
 * Shared SnapUp brand tokens — the single source of truth for both apps.
 *
 * Every colour is defined twice, once per theme, and reaches components as a CSS variable
 * rather than a literal. That is what lets `bg-surface` mean white in the aisle and
 * near-black at night without a single component knowing which theme is active.
 *
 * Values are stored as "R G B" channel triplets rather than hex so Tailwind's opacity
 * modifiers keep working — `bg-primary/10` compiles to `rgb(var(--color-primary) / 0.1)`.
 */

/** Light: the original brand palette. Mint, near-black ink, mint-tint wash. */
const light = {
  primary: '#00C4A7',
  primaryDark: '#00A88F',
  /** Text/icon colour that sits on a primary fill. */
  onPrimary: '#FFFFFF',
  accent: '#2D2D2D',
  onAccent: '#FFFFFF',
  /** Near-white page ground; every card sits on it as pure white. */
  bg: '#F4F5F7',
  surface: '#FFFFFF',
  /** Subtle raised fill: icon tiles, table headers, hover rows. */
  tint: '#E6F8F4',
  ink: '#1C1C1E',
  /** Darkened from the design's grey, which fell below 4.5:1 on white. */
  muted: '#6B7280',
  border: '#ECEDF0',
  danger: '#E5342A',
  warning: '#B4740A',
  success: '#00845F',
  /**
   * The violet used for the location link and the Recent tile.
   *
   * A second hue rather than a primary variant, because it marks a different kind of
   * thing: primary means "act on this", violet means "this is where you are". Using the
   * brand mint for both would make the location look like a button.
   */
  violet: '#6D4AFF',
  onViolet: '#FFFFFF',
};

/**
 * Dark: not an inversion. Surfaces are warm-neutral greens rather than grey so the mint
 * still reads as the brand colour, and the mint itself is lifted because #00C896 loses
 * too much presence against a dark ground.
 */
const dark = {
  primary: '#2ED9AC',
  primaryDark: '#5CE7C4',
  /**
   * Near-black on the brighter mint. White on this mint measures 1.9:1, which is
   * unreadable; this is roughly 9:1.
   */
  onPrimary: '#052019',
  accent: '#243330',
  onAccent: '#E9F2EF',
  bg: '#0B1210',
  surface: '#141D1B',
  tint: '#182622',
  ink: '#E9F2EF',
  muted: '#9AACA7',
  border: '#27342F',
  danger: '#FF7B84',
  warning: '#FFC15E',
  success: '#4ADEB0',
  /** Lifted, for the same reason the mint is: #6D4AFF disappears against a dark ground. */
  violet: '#A78BFA',
  onViolet: '#1A1033',
};

/** '#00C896' -> '0 200 150', the form `rgb(... / <alpha-value>)` expects. */
function channels(hex) {
  const value = hex.replace('#', '');
  const expanded = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const int = parseInt(expanded, 16);
  return `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`;
}

/** Tailwind colour scale: every token resolves through its variable. */
const colors = Object.fromEntries(
  Object.keys(light).map((name) => [name, `rgb(var(--color-${name}) / <alpha-value>)`])
);

/** A `:root` / `[data-theme="dark"]` variable block, consumed by the Tailwind preset. */
function cssVariables(palette) {
  return Object.fromEntries(
    Object.entries(palette).map(([name, hex]) => [`--color-${name}`, channels(hex)])
  );
}

module.exports = { palettes: { light, dark }, colors, cssVariables, channels };
