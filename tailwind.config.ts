import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base: '#0f0d1a',
          sidebar: '#16142a',
          surface: '#16142a',
          'surface-raised': '#1a1730',
        },
        border: {
          subtle: '#211e3a',
          divider: '#1c1a30',
        },
        text: {
          primary: '#fafafa',
          body: '#e2e0eb',
          secondary: '#a09cb8',
          muted: '#6b6786',
        },
        accent: {
          from: '#a78bfa',
          to: '#f472b6',
        },
        status: {
          'active-fg': '#86efac',
          'active-bg': '#14301f',
          'broken-fg': '#fca5a5',
          'broken-bg': '#3f1414',
          'retired-fg': '#a1a1aa',
          'retired-bg': '#1f1f22',
          'returned-fg': '#fcd34d',
          'returned-bg': '#3f2e0e',
          'sold-fg': '#a5b4fc',
          'sold-bg': '#1e1b4b',
          'donated-fg': '#c4b5fd',
          'donated-bg': '#241942',
          'excluded-fg': '#71717a',
          'excluded-bg': '#18181b',
        },
        delta: {
          up: '#4ade80',
          down: '#f87171',
        },
        chip: {
          'active-from': '#2a1e4a',
          'active-to': '#3d1d3a',
          'active-border': '#a78bfa66',
          'active-text': '#e9d5ff',
          'add-border': '#3a3550',
        },
        badge: {
          warn: '#3f2e0e',
          'warn-text': '#fbbf24',
        },
      },
      backgroundImage: {
        'accent-gradient': 'linear-gradient(135deg, #a78bfa 0%, #f472b6 100%)',
        'chip-active': 'linear-gradient(135deg, #2a1e4a 0%, #3d1d3a 100%)',
        'blob-gradient': 'radial-gradient(circle, #a78bfa 0%, #f472b6 70%)',
      },
      boxShadow: {
        'accent-glow': '0 0 12px #a78bfa80',
        'card': '0 1px 3px rgba(17,12,46,0.06)',
        'popover': '0 12px 32px rgba(0,0,0,0.5)',
        'brand-mark': '0 4px 16px #8b5cf660',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        'shell': '14px',
        'card': '13px',
        'kpi': '11px',
        'chip': '9px',
        'pill': '7px',
        'input': '10px',
      },
    },
  },
  plugins: [],
};

export default config;
