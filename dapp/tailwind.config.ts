import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        obscura: {
          purple: "#7C3AED",
          dark: "#0F0B1E",
          card: "#1A1330",
          border: "#2D2448",
        },
      },
    },
  },
  plugins: [],
};
export default config;
