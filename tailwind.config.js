/** @type {import('tailwindcss').Config} */

// "Harbour night" palette. The UI was built entirely on Tailwind's slate (surfaces,
// text) and cyan (accent) scales, so redefining those two scales re-skins every
// component consistently: slate becomes a deep, slightly warm navy with sand-tinted
// light steps, cyan becomes a calmer sea blue.
const harbour = {
  50: '#f7f5f0',
  100: '#efebe2',
  200: '#ddd8cc',
  300: '#bcc0c0',
  400: '#8e99a2',
  500: '#68757f',
  600: '#47555f',
  700: '#2c3b48',
  800: '#182938',
  900: '#0d1b29',
  950: '#07111b',
};
const sea = {
  50: '#eef8fb',
  100: '#d3eef5',
  200: '#aadfec',
  300: '#7fcbe0',
  400: '#56b4d3',
  500: '#3299bd',
  600: '#237da0',
  700: '#1e6582',
  800: '#1c526a',
  900: '#1a4558',
  950: '#0e2c3a',
};

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        slate: harbour,
        cyan: sea,
        // Warm accent for the few things that should pop ("Here now", hero kickers)
        coral: { 300: '#ffb690', 400: '#ff9a6b', 500: '#f47c4c' },
        dark: { 900: harbour[900], 800: harbour[800], 700: harbour[700], 600: harbour[600] },
      },
      fontFamily: {
        // Long-form journal text and headings
        serif: ['"Source Serif 4"', 'Georgia', 'Cambria', 'serif'],
        // UI chrome stays on the platform font — fast, familiar, no extra download
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
