module.exports = {
  plugins: [
    require("../../frontend/node_modules/tailwindcss")({
      config: "./tailwind.config.cjs",
    }),
  ],
};
