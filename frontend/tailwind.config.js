/** @type {import('tailwindcss').Config} */
module.exports = {
  blocklist: ["overline"],
  darkMode: ["class"],
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
  theme: {
    extend: {
      colors: {
        // Planes. Depth is value, not translucency. These mirror the :root
        // tokens in index.css and must be changed together — a Tailwind
        // text-surface utility and a var(--surface) are not the same colour
        // source, so editing one alone leaves half the page behind.
        void: "#10141C",
        surface: "#171D28",
        surface2: "#1F2632",
        well: "#131822",
        // Text — keeps 4.5:1 on the lighter ground, including on surface2.
        ink: "#EEF1F6",
        steel: "#AEB7C6",
        faint: "#868FA0",
        // Data accents, carried over from the desk so the two surfaces match.
        mint: "#00E5A0",
        cobalt: "#82A9FF",
        bear: "#FF4D6A",
        amber: "#FFB347",
        line: "rgba(255,255,255,0.09)",
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
