/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('@snapup/ui/tailwindPreset')],
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    // Shared components live outside this app but their classes still have to be
    // generated here — Tailwind only sees what the content globs list.
    '../../packages/ui/**/*.{js,ts,jsx,tsx}',
  ],
};
