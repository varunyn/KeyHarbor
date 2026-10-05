export default {
  extends: ["stylelint-config-recommended"],
  ignoreFiles: ["src/renderer-build/**"],
  overrides: [
    {
      customSyntax: "postcss-html",
      files: ["src/views/**/*.html"],
    },
  ],
  rules: {
    "at-rule-no-unknown": [true, { ignoreAtRules: ["theme", "source"] }],
    "declaration-property-value-keyword-no-deprecated": null,
    "no-descending-specificity": null,
    "no-duplicate-selectors": null,
    "property-no-deprecated": null,
  },
};
