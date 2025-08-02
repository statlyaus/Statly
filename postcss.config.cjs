// postcss.config.cjs
module.exports = {
  plugins: {
    'tailwindcss/nesting': require('tailwindcss/nesting'),
    tailwindcss: {},
    autoprefixer: {},
  },
};