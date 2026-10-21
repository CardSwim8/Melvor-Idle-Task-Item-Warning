import js from "@eslint/js";
import globals from "globals";

// Globals the game defines that the mod reads.
const melvor = {
  game: "readonly",
  cloudManager: "readonly",
  gameVersion: "readonly",
  tippy: "readonly",
  Swal: "readonly",
  SwalLocale: "readonly",
  Bank: "readonly",
  Player: "readonly",
  TownshipTasks: "readonly",
  TownshipCasualTasks: "readonly",
  ShopCostsAndUnlock: "readonly"
};

export default [
  { ignores: ["dist/", "node_modules/"] },
  js.configs.recommended,
  {
    rules: {
      "no-unused-vars": ["error", { caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }]
    }
  },
  {
    files: ["src/**/*.mjs"],
    languageOptions: { globals: { ...globals.browser, ...melvor } }
  },
  {
    files: ["scripts/**/*.mjs", "test/**/*.mjs", "*.js"],
    languageOptions: { globals: globals.node }
  }
];
