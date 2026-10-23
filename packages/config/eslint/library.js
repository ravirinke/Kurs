import globals from "globals";
import tseslint from "typescript-eslint";

import { baseConfig } from "./base.js";

/** For plain TypeScript packages (core, db). */
export default tseslint.config(...baseConfig, {
  languageOptions: {
    globals: globals.node,
  },
});
