/** @type {import("eslint").Linter.Config} */
import js from "@eslint/js";
import next from "eslint-config-next";

export default [
  js.configs.recommended,
  ...next,
  {
    rules: {
      semi: ["error", "always"],
      quotes: ["error", "double"],
      "no-console": "warn",
      "@next/next/no-html-link-for-pages": "off"
    }
  }
];