import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Ink palette via CSS variables so the theme toggle (light/dark)
        // can remap them without recompiling Tailwind. Variables are
        // defined in globals.css under :root (dark default) and html.light.
        // Each var holds an "R G B" triple so Tailwind's <alpha-value>
        // helper still works (e.g. bg-ink-700/40 keeps opacity).
        ink: {
          950: 'rgb(var(--ink-950) / <alpha-value>)',
          900: 'rgb(var(--ink-900) / <alpha-value>)',
          850: 'rgb(var(--ink-850) / <alpha-value>)',
          800: 'rgb(var(--ink-800) / <alpha-value>)',
          700: 'rgb(var(--ink-700) / <alpha-value>)',
          600: 'rgb(var(--ink-600) / <alpha-value>)',
          500: 'rgb(var(--ink-500) / <alpha-value>)',
          400: 'rgb(var(--ink-400) / <alpha-value>)',
          300: 'rgb(var(--ink-300) / <alpha-value>)',
          200: 'rgb(var(--ink-200) / <alpha-value>)',
          100: 'rgb(var(--ink-100) / <alpha-value>)',
        },
        // POVA brand orange
        flare: {
          500: '#FF6A1A',
          400: '#FF7F38',
          300: '#FFA371',
        },
        signal: {
          green: '#22C55E',
          amber: '#F59E0B',
          red: '#EF4444',
          blue: '#3B82F6',
          violet: '#8B5CF6',
        },
        // Semantic aliases — map to the same hues as signal.* so designers
        // and code can reach for the meaning ("good" / "bad") rather than
        // the literal hue. The 300/400/500 stops give us hover + emphasis
        // headroom inside Tailwind's @apply / arbitrary-opacity machinery
        // (e.g. `bg-good-500/10`, `text-good-300`, `border-good-500/40`).
        // Round 3 audit found 27 callsites using `text-good-400`, etc.
        // that were silently dead before this block existed.
        good:  { 300: '#86EFAC', 400: '#4ADE80', 500: '#22C55E' },
        bad:   { 300: '#FCA5A5', 400: '#F87171', 500: '#EF4444' },
        warn:  { 300: '#FCD34D', 400: '#FBBF24', 500: '#F59E0B' },
        info:  { 300: '#93C5FD', 400: '#60A5FA', 500: '#3B82F6' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      // Lifted one step across the board. The previous scale bottomed out at
      // 10px and the board rendered 25,785 text nodes at that size, which is
      // below any reasonable reading floor and the main reason the dashboards
      // read as cluttered rather than dense. Line heights grow with it, since
      // cramped leading was doing as much damage as the size.
      fontSize: {
        '2xs': ['11px', { lineHeight: '15px' }],
        xs: ['12px', { lineHeight: '17px' }],
        sm: ['13px', { lineHeight: '19px' }],
        base: ['15px', { lineHeight: '22px' }],
      },
      // Radius scale tightened one notch. The default 8/12px reads as a
      // consumer app; 3-6px reads as an instrument, which is what this is.
      borderRadius: {
        sm: '2px',
        DEFAULT: '3px',
        md: '4px',
        lg: '5px',
        xl: '6px',
        '2xl': '8px',
      },
      boxShadow: {
        'col': '0 0 0 1px rgba(255,255,255,0.04), 0 8px 24px rgba(0,0,0,0.4)',
        'pop': '0 12px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)',
      },
      animation: {
        'pulse-slow': 'pulse 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};

export default config;
