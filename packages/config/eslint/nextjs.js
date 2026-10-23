import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";

import { baseConfig } from "./base.js";

/** For Next.js apps. */
export default tseslint.config(...nextCoreWebVitals, ...baseConfig);
