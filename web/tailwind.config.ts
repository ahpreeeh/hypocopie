export default {
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          950: '#1e1b4b',
        },
        success: {
          50: '#f0fdf4',
          100: '#dcfce7',
          500: '#22c55e',
          700: '#15803d',
          950: '#052e16',
        },
        danger: {
          50: '#fef2f2',
          100: '#fee2e2',
          500: '#ef4444',
          700: '#b91c1c',
          950: '#450a0a',
        },
        warn: {
          50: '#fffbeb',
          100: '#fef3c7',
          500: '#f59e0b',
          700: '#b45309',
          950: '#451a03',
        },
      },
      fontSize: {
        h1: ['1.875rem', { lineHeight: '2.25rem', fontWeight: '700' }],
        h2: ['1.5rem', { lineHeight: '2rem', fontWeight: '700' }],
        h3: ['1.25rem', { lineHeight: '1.75rem', fontWeight: '600' }],
        body: ['0.9375rem', { lineHeight: '1.5rem' }],
        caption: ['0.8125rem', { lineHeight: '1.25rem' }],
      },
      borderRadius: {
        card: '0.75rem',
        input: '0.5rem',
        pill: '9999px',
      },
    },
  },
};
