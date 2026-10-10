/** @type {import('tailwindcss').Config} */
module.exports = {
  blocklist: ["overline"],
  darkMode: ["class"],
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
  theme: {
    extend: {
      colors: {
        // Planes. Depth is value, not translucency.
        void: "#07090F",
        surface: "#0E1219",
        surface2: "#141924",
        well: "#0A0D14",
        // Text
        ink: "#EDEFF3",
        steel: "#9AA3B2",
        faint: "#6E7686",
        // Data accents, carried over from the desk so the two surfaces match.
        mint: "#00E5A0",
        bear: "#FF4D6A",
        amber: "#FFB347",
        line: "rgba(255,255,255,0.07)",
      },
      fontFamily: {
        display: ["Sora", "sans-serif"],
        sans: ["'DM Sans'", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      maxWidth: { desk: "1160px" },
      borderRadius: { panel: "14px", well: "10px" },
      transitionTimingFunction: { out: "cubic-bezier(0.22,1,0.36,1)" },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
