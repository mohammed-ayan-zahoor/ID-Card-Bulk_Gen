module.exports = {
  content: ['./public/editor.html'],
  theme: {
    borderRadius: { none: '0', sm: '2px', DEFAULT: '3px', md: '4px', full: '9999px' },
    colors: {
      transparent: 'transparent', current: 'currentColor', white: '#FFFFFF',
      pasteboard: '#2B2B2B', chrome: '#3A3A3A', panel: '#424242', tabs: '#383838',
      field: '#2E2E2E', selected: '#535353', hover: '#4A4A4A', line: '#2A2A2A', control: '#5A5A5A',
      ink: { DEFAULT: '#D2D2D2', dim: '#9A9A9A', off: '#6E6E6E', 900: '#D2D2D2', 700: '#B0B0B0', 500: '#9A9A9A', 300: '#5A5A5A', 100: '#3A3A3A' },
      accent: { DEFAULT: '#5B4CF0', hover: '#6D60F5', soft: '#3D357A' }, guide: '#FF3DA5',
      success: '#2E8B63', warning: '#C98A2E', danger: { DEFAULT: '#E14B4B', soft: '#4A2525' },
      surface: '#424242', 'surface-sunken': '#2E2E2E',
      tint: { lavender: '#3A3A3A', 'lavender-ink': '#D2D2D2', mint: '#3A3A3A', 'mint-ink': '#D2D2D2', sand: '#3A3A3A', 'sand-ink': '#D2D2D2', sky: '#3A3A3A', 'sky-ink': '#D2D2D2' },
    },
    fontFamily: { sans: ['system-ui', 'sans-serif'], mono: ['ui-monospace', 'monospace'] },
    extend: {},
  },
  plugins: [],
};
