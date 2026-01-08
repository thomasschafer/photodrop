/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Warm terracotta palette
        primary: {
          50: '#fdf8f6',
          100: '#faefeb',
          200: '#f5ddd4',
          300: '#e8c4b4',
          400: '#d9a68e',
          500: '#c67d5a', // Terracotta
          600: '#b56a4a',
          700: '#97553c',
          800: '#7c4735',
          900: '#673d30',
        },
        neutral: {
          50: '#fdfcfa', // Warm cream background
          100: '#f9f6f3',
          200: '#f0ebe6',
          300: '#e2dbd3',
          400: '#b8afa5',
          500: '#8a8078',
          600: '#6b635b',
          700: '#524c46',
          800: '#3a3632',
          900: '#252320',
        },
        accent: {
          50: '#fdf7f5',
          100: '#faeee9',
          200: '#f2d9d0',
          300: '#e5baa8',
          400: '#d4967a',
          500: '#bf7354', // Warm sienna
          600: '#a85f43',
          700: '#8c4d38',
          800: '#744132',
          900: '#61382c',
        },
        error: '#c45454',
        warning: '#c4864a',
        success: '#6a9a72',
        info: '#6a7a8a',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.75rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.75rem' }],
        '5xl': ['3rem', { lineHeight: '3.5rem' }],
      },
      borderRadius: {
        xl: '0.75rem',
        '2xl': '1rem',
      },
      boxShadow: {
        soft: '0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03)',
        card: '0 2px 8px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02)',
        elevated: '0 4px 12px rgba(0, 0, 0, 0.06), 0 2px 4px rgba(0, 0, 0, 0.03)',
      },
      maxWidth: {
        form: '24rem', // 384px - good for forms
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
