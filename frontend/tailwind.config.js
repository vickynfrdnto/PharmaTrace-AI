/** @type {import('tailwindcss').Config} */
const c = (n) => `rgb(var(--${n}) / <alpha-value>)`
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      opacity: { 6: '.06', 8: '.08', 12: '.12', 35: '.35', 45: '.45', 55: '.55', 85: '.85' },
      colors: {
        canvas: c('canvas'), surface: c('surface'), sunken: c('sunken'), line: c('line'),
        ink: c('ink'), muted: c('muted'), faint: c('faint'),
        brand: c('brand'), onbrand: c('onbrand'),
        info: c('info'), warn: c('warn'), risk: c('risk'),
        side: c('side'), stage: '#071719',
        lime: '#99CC44',
        door1: '#4C9AFF', door2: '#2DD4A7', door3: '#FFB020',
      },
      // Skala tipografi rapat: root 13px (desktop) ≈ tampilan zoom 80%
      fontSize: {
        '2xs': ['.78rem', { lineHeight: '1.1rem' }],
        xs: ['.88rem', { lineHeight: '1.25rem' }],
        sm: ['1rem', { lineHeight: '1.45rem' }],
        base: ['1.08rem', { lineHeight: '1.6rem' }],
        lg: ['1.2rem', { lineHeight: '1.6rem' }],
        xl: ['1.42rem', { lineHeight: '1.8rem' }],
        '2xl': ['1.75rem', { lineHeight: '2.1rem' }],
        '3xl': ['2.2rem', { lineHeight: '2.5rem' }],
        '4xl': ['2.9rem', { lineHeight: '3rem' }],
        '5xl': ['3.8rem', { lineHeight: '3.8rem' }],
      },
      fontFamily: {
        sans: ['"Onest Variable"', 'system-ui', 'Segoe UI', 'sans-serif'],
        display: ['"Bricolage Grotesque Variable"', '"Onest Variable"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        lift: '0 1px 2px rgb(var(--shadow) / .05), 0 10px 28px -14px rgb(var(--shadow) / .22)',
        pop: '0 2px 4px rgb(var(--shadow) / .06), 0 24px 60px -20px rgb(var(--shadow) / .38)',
        glow: '0 0 0 1px rgb(var(--brand) / .35), 0 8px 30px -8px rgb(var(--brand) / .45)',
      },
      keyframes: {
        sheen: { '0%': { transform: 'translateX(-120%)' }, '100%': { transform: 'translateX(220%)' } },
        pulseRing: { '0%': { transform: 'scale(.8)', opacity: '.7' }, '100%': { transform: 'scale(2.2)', opacity: '0' } },
        floaty: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        shimmer: { '100%': { backgroundPosition: '-200% 0' } },
      },
      animation: {
        sheen: 'sheen 2.4s ease-in-out infinite',
        pulseRing: 'pulseRing 1.8s ease-out infinite',
        floaty: 'floaty 5s ease-in-out infinite',
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [],
}
