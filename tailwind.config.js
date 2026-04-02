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
        // Azure Navigator Brand Colors
        'deep-navy': '#0b1326',
        'coral': '#ffb690',
        'azure': '#7bd0ff',
        'text-primary': '#dae2fd',
        'text-secondary': '#94a3b8',
        // Preserve your original phase colors if needed, 
        // but the new UI uses the brand palette above.
        dark: {
          900: '#0f172a',
          800: '#1e293b',
          700: '#334155',
          600: '#475569',
        },
      },
      fontFamily: {
        'space': ['Space Grotesk', 'sans-serif'],
        'manrope': ['Manrope', 'sans-serif'],
        // Fallback for existing 'sans' usage
        sans: ['Manrope', 'Inter', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'glass-gradient': 'linear-gradient(135deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.05))',
      }
    },
  },
  plugins: [],
}
