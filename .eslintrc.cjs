module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
  },
  extends: ["eslint:recommended"],
  rules: {
    "no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      },
    ],
  },
  ignorePatterns: ["node_modules/", "gallery/"],
  parserOptions: {
    ecmaVersion: "latest",
  },
  globals: {
    fetch: "readonly",
    AbortController: "readonly",
    URL: "readonly",
  },
  overrides: [
    {
      files: ["public/**/*.js"],
      env: {
        browser: true,
        es2022: true,
      },
      parserOptions: {
        sourceType: "module",
      },
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        HTMLElement: "readonly",
        URL: "readonly",
        fetch: "readonly",
      },
    },
    {
      files: ["tests/**/*.js"],
      env: {
        node: true,
      },
    },
  ],
};
