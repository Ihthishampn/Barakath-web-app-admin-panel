import type { Config } from 'tailwindcss';

/** Barakath web — same design tokens as the admin (CSS vars in app/globals.css). */
export default {
  content: ['./src/**/*.{ts,tsx}'],
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
          'gold-border': 'var(--brand-gold-border)',
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
      maxWidth: {
        // Full available width — sections reach close to the edges (40px gutter
        // via px-10), matching the hero. Product grids use auto-fill so cards
        // stay ~220-256px (more columns on wider screens, not bigger cards).
        page: '100%',
      },
    },
  },
  plugins: [],
} satisfies Config;
