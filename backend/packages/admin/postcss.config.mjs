// Tailwind v4 uses a PostCSS plugin (@tailwindcss/postcss). No tailwind.config.js
// is required — theme/config lives in globals.css via @theme / @import "tailwindcss".
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
