/** @type {import('tailwindcss').Config} */
module.exports = {
  blocklist: ["overline"],
  darkMode: ["class"],
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
  theme: {
    extend: {
      colors: {
        void: "#06080F",
        ink: "#E8ECF4",
        steel: "#8A93A6",
        mint: "#00E5A0",
        bear: "#FF4D6A",
        amber: "#FFB347",
        line: "rgba(255,255,255,0.08)",
      },
      fontFamily: {
        display: ["Sora", "sans-serif"],
        sans: ["'DM Sans'", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      maxWidth: { desk: "1240px" },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
