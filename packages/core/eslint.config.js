import library from "@aksjeliga/config/eslint/library";

/**
 * core must stay pure: no I/O, no framework, no database. It is shared by the web app
 * and the future mobile app.
 */
export default [
  ...library,
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*", "react", "react/*", "react-dom", "react-dom/*"],
              message: "core must not depend on UI frameworks.",
            },
            {
              group: [
                "@aksjeliga/db",
                "@aksjeliga/db/*",
                "drizzle-orm",
                "drizzle-orm/*",
                "postgres",
                "@supabase/*",
              ],
              message: "core must not depend on the database.",
            },
            {
              group: ["node:*", "fs", "path", "http", "https", "net", "child_process"],
              message: "core must not do I/O.",
            },
          ],
        },
      ],
      "no-restricted-globals": ["error", { name: "fetch", message: "core must not do I/O." }],
    },
  },
];
