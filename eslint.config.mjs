import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    /* Non-build entries are pre-existing code that predates linting;
       un-ignore them as they are touched rather than adding new ones. */
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "app/admin/**",
      "app/api/**",
      "components/settings-dialog/**",
      "components/tables/**",
      "components/ui/code-editor.tsx",
      "components/ui/multi-dropdown.tsx",
      "components/ui/sidebar.tsx",
      "hooks/use-file-upload.ts",
      "hooks/use-mobile.tsx",
      "lib/market-api/**",
      "packages/db/**",
      "postcss.config.js",
      "proxy.ts",
      "tailwind.config.ts",
      "uploads/**"
    ]
  },
  ...nextCoreWebVitals,
  ...nextTypescript
];

export default eslintConfig;
