import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";

import { baseConfig } from "./base.js";

/** For Next.js apps. */
export default tseslint.config(...nextCoreWebVitals, ...baseConfig, {
  files: ["**/*.ts", "**/*.tsx"],
  rules: {
    // Event handlers like onChange={(e) => setValue(e.target.value)} are idiomatic React.
    "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
  },
});
