// postcss.config.cjs
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
    'tailwindcss/nesting': require('tailwindcss/nesting'),
    tailwindcss: {},
    autoprefixer: {},
  },
};
