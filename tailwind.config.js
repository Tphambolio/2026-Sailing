/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Custom dark theme colors
        dark: {
          900: '#0f172a',
          800: '#1e293b',
          700: '#334155',
          600: '#475569',
        },
        // Phase colors (vibrant accents)
        phase: {
          venice: '#06b6d4',      // cyan
          montenegro: '#8b5cf6',  // violet
          greece: '#f59e0b',      // amber
          turkey: '#ef4444',      // red
          cyprus: '#10b981',      // emerald
          return: '#ec4899',      // pink
        },
        // Stop type colors
        marina: '#3b82f6',        // blue
        anchorage: '#f97316',     // orange
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
