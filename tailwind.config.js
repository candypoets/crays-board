/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        crays: {
          pink: "#F50A48",
          coral: "#FF7668",
          night: "#160A11",
          paper: "#FFF7F8",
          ink: "#2B1420"
        }
      }
    }
  },
  plugins: []
};
