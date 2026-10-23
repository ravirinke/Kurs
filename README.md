# Aksjeliga

En app der venner konkurrerer i ligaer ved å handle ekte aksjer med **fiktive penger**.
Arbeidsnavnet «Aksjeliga» ligger i `apps/web/src/i18n/nb.ts` og kan byttes der.

- Oppdraget: [`docs/oppdrag.md`](docs/oppdrag.md)
- Design: [`docs/design.md`](docs/design.md)
- Arkitekturvalg: [`docs/decisions.md`](docs/decisions.md)

## Krav

| Verktøy        | Versjon | Merknad                           |
| -------------- | ------- | --------------------------------- |
| Node.js        | 24      | Se `.nvmrc`                       |
| pnpm           | 12      | Aktiveres med corepack (se under) |
| Docker Desktop | nyeste  | Må kjøre for lokal Supabase       |

## Kom i gang

```bash
# 1. Aktiver pnpm (én gang per maskin).
#    Gir «EPERM» på Windows? Legg til: --install-directory "%APPDATA%\npm"
corepack enable pnpm

# 2. Installer avhengigheter
pnpm install

# 3. Lag miljøfil (verdiene er standardverdiene for lokal Supabase)
cp .env.example .env

# 4. Start lokal Supabase (Docker Desktop må kjøre). Første gang tar det noen minutter.
pnpm db:start

# 5. Start appen
pnpm dev
```

Åpne deretter:

| Hva                                           | Adresse                |
| --------------------------------------------- | ---------------------- |
| Appen                                         | http://localhost:3000  |
| Supabase Studio (database-GUI)                | http://localhost:54323 |
| Mailpit (innloggingslenker havner her lokalt) | http://localhost:54324 |

Stopp Supabase med `pnpm db:stop` når du er ferdig.

## Skript

Kjøres fra rotmappen. Turborepo kjører dem i alle pakker.

| Skript                                    | Hva det gjør                        |
| ----------------------------------------- | ----------------------------------- |
| `pnpm dev`                                | Starter web-appen i utviklingsmodus |
| `pnpm build`                              | Bygger alt for produksjon           |
| `pnpm test`                               | Kjører alle tester (Vitest)         |
| `pnpm typecheck`                          | Sjekker typer (TypeScript strict)   |
| `pnpm lint`                               | ESLint                              |
| `pnpm format` / `pnpm format:check`       | Prettier: formater / sjekk          |
| `pnpm db:start` / `db:stop` / `db:status` | Lokal Supabase                      |

## Struktur

```
apps/
  web/          Next.js (App Router), Tailwind, shadcn/ui
packages/
  core/         All forretningslogikk. Ren TypeScript, ingen I/O.
  db/           Drizzle-skjema, migrasjoner, seed
  config/       Delt tsconfig, ESLint, Prettier og Vitest
supabase/       Lokal Supabase-konfig
docs/           Oppdrag, design og beslutninger
```

## Feilsøking

- **`pnpm db:start` feiler med «Cannot connect to the Docker daemon»:** start Docker Desktop og vent på «Engine running».
- **Port opptatt:** en annen Supabase-instans kjører kanskje. Kjør `pnpm db:stop`, eller `pnpm exec supabase stop --all`.
