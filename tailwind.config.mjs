// tailwind.config.mjs

export default {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './Header.tsx',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#3b82f6', // or your preferred primary color
      },
    },
  },
  plugins: [],
};
