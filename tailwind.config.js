/** @type {import('tailwindcss').Config} */
module.exports = {
  // Preflight off: the app's hand-written globals.css owns the base styles.
  // Tailwind is additive here, used only by the sidebar and the pipeline board.
  corePlugins: { preflight: false },
  content: [
    "./app/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0a0b0e",
        panel: "#141519",
        panel2: "#1a1c22",
        edge: "#262a32",
        ink: "#e8eaed",
        muted: "#8b909b",
        faint: "#5a5f6a",
      },
    },
  },
  plugins: [],
};
