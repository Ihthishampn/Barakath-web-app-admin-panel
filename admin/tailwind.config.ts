import type { Config } from 'tailwindcss';

/**
 * Tailwind maps to the reproduced Barkath design tokens (CSS vars in index.css).
 * Token names mirror the prototype's `--brand-primary`, `--surface-card`, etc.
 * (harvested from designs/Barakath Admin Prototype.dc.html).
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: 'var(--brand-primary)',
          'primary-dark': 'var(--brand-primary-dark)',
          'primary-subtle': 'var(--brand-primary-subtle)',
          gold: 'var(--brand-gold)',
          'gold-strong': 'var(--brand-gold-strong)',
          'gold-subtle': 'var(--brand-gold-subtle)',
        },
        surface: {
          app: 'var(--surface-app)',
          card: 'var(--surface-card)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)',
        },
        border: {
          subtle: 'var(--border-subtle)',
          DEFAULT: 'var(--border-default)',
        },
        success: { DEFAULT: 'var(--success)', subtle: 'var(--success-subtle)' },
        error: { DEFAULT: 'var(--error)', subtle: 'var(--error-subtle)' },
        info: { DEFAULT: 'var(--info)', subtle: 'var(--info-subtle)' },
        neutral: { 200: 'var(--neutral-200)', 300: 'var(--neutral-300)' },
      },
      fontFamily: {
        display: 'var(--font-display)',
        ui: 'var(--font-ui)',
      },
      borderRadius: {
        sm: '8px',
        DEFAULT: '12px',
        md: '12px',
        lg: '16px',
        pill: '999px',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow-md)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      letterSpacing: {
        label: '0.1em',
      },
    },
  },
  plugins: [],
} satisfies Config;
