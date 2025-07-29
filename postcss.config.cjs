// postcss.config.cjs
const tailwindcss = require('tailwindcss');
const autoprefixer = require('autoprefixer');
const nesting = require('postcss-nesting');

module.exports = {
  plugins: [
    nesting,
    tailwindcss,
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('@tailwindcss/aspect-ratio'),
    require('@tailwindcss/line-clamp'),
    require('@tailwindcss/container-queries'),
    require('daisyui'),
    autoprefixer,
  ],
};