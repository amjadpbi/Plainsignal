import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Etsy-ish warm accent, used sparingly.
        brand: {
          DEFAULT: '#e07a3f',
          dark: '#c25f28',
        },
      },
    },
  },
  plugins: [],
};

export default config;
