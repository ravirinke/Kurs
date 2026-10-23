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
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "core must not do I/O." },
        { name: "parseFloat", message: "Never parse money into a JS number. Use decimal()." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message: "core never reads the clock. Take `now` as an argument or a Clock.",
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: "Use Luxon DateTime, and take `now` as an argument.",
        },
        {
          selector:
            "CallExpression[callee.object.name='DateTime'][callee.property.name=/^(now|local|utc)$/]",
          message: "core never reads the clock. Take `now` as an argument or a Clock.",
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: "core must be deterministic.",
        },
        {
          selector: "CallExpression[callee.property.name='toNumber']",
          message: "Never turn a Decimal into a JS number.",
        },
      ],
    },
  },
];
