/**
 * Shared SnapUp brand tokens — same palette used in apps/customer-web.
 * Both apps' tailwind.config.js extend this, so the brand identity (mint
 * #00C896, near-black ink, mint-tint background) stays a single source of
 * truth instead of two configs that can quietly drift apart.
 */
module.exports = {
  colors: {
    primary: '#00C896',
    primaryDark: '#00A87E',
    accent: '#2D2D2D',
    bg: '#EAF8F5',
    surface: '#FFFFFF',
    ink: '#1C1C1C',
    muted: '#828A89',
    border: '#E5EAE9',
    danger: '#E63946',
    warning: '#F5A623',
  },
  borderRadius: {
    xl2: '32px',
  },
};
