/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        hydra: {
          900: '#07090e',
          800: '#0d111a',
          700: '#141b29',
          600: '#1e293b',
          accent: '#06b6d4',
          accentHover: '#0891b2',
        }
      }
    },
  },
  plugins: [],
}
