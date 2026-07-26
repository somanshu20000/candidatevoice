module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}", "./src/app/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Off-white paper stock. `paper` is the page ground, `sheet` is a
        // lighter leaf laid on top of it (cards), `sunk` reads as pressed in
        // (inputs, wells).
        paper: {
          DEFAULT: "#F4F1EA",
          sheet: "#FCFBF7",
          sunk: "#EBE7DC",
        },
        // Hairline rules. Deliberately warm so they don't read as cold UI grey.
        rule: {
          DEFAULT: "#E0DBCE",
          strong: "#CFC8B7",
        },
        // Warm near-black ink rather than pure black — black on cream looks
        // harsh and un-printed.
        ink: {
          DEFAULT: "#1F1D18",
          soft: "#46423A",
          muted: "#6B6659",
          faint: "#9C9689",
        },
        // Single accent: deep ink blue, as on a printed form.
        accent: {
          DEFAULT: "#27405E",
          hover: "#1B2E45",
          wash: "#EAEEF3",
        },
        // HQS verdict colors, desaturated to sit on paper without glowing.
        good: "#3D6B4F",
        warn: "#96702B",
        bad: "#9B3B33",
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "Cambria", "serif"],
        sans: ["var(--font-sans)", "system-ui", "-apple-system", "sans-serif"],
      },
      boxShadow: {
        // Warm-tinted and shallow — a sheet resting on a sheet, not a floating
        // material card.
        sheet:
          "0 1px 1px rgba(31,29,24,.03), 0 6px 18px -10px rgba(31,29,24,.10)",
        "sheet-lg":
          "0 1px 2px rgba(31,29,24,.04), 0 20px 44px -20px rgba(31,29,24,.16)",
        press: "inset 0 1px 2px rgba(31,29,24,.06)",
      },
    },
  },
  plugins: [],
};
