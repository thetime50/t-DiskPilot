/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b1419',
        panel: '#132029',
        panel2: '#1a2f3a',
        border: '#2a4550',
        muted: '#8aa3ad',
        accent: {
          DEFAULT: '#14b8a6',
          hover: '#2dd4bf',
          deep: '#0f766e',
        },
        ok: '#34d399',
        warn: '#fbbf24',
        danger: '#f87171',
      },
      textColor: {
        DEFAULT: '#e8eef2',
      },
    },
  },
  plugins: [],
};
