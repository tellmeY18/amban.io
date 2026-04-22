# amban.io

> Know your number. Own your day.

A mobile-first personal finance tracker for iOS and Android. 100% local. No accounts. No cloud. No network calls.

Every other finance app focuses on what you *spent*. amban tells you what you *can* spend — today, specifically. The whole app reduces budgeting to a single number: your **Daily Amban Score**.

---

## Documentation

- **[`CLAUDE.md`](./CLAUDE.md)** — Product spec. The single source of truth for *what* to build.
- **[`ROADMAP.md`](./ROADMAP.md)** — Execution plan. The single source of truth for *how* and *in what order*.

All implementation decisions should reference those two files. If the code and the spec disagree, the spec wins — or the spec gets updated, never silently drifted.

---

## Tech Stack

- **UI:** React + Ionic React (via Vite)
- **Mobile runtime:** CapacitorJS (iOS + Android)
- **Storage:** `@capacitor-community/sqlite` + `@capacitor/preferences`
- **State:** Zustand
- **Dates:** `date-fns`
- **Charts:** Recharts
- **Language:** TypeScript (strict)

Full details in [`CLAUDE.md` §2](./CLAUDE.md#2-tech-stack).

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | 20 LTS or newer (tested on 24.x) |
| npm | 10 or newer |
| Xcode | 15+ (for iOS builds) |
| Android Studio | Hedgehog or newer |
| JDK | 17 |
| CocoaPods | Latest (`brew install cocoapods`) |
| Ruby | System Ruby is fine for CocoaPods |

Versions are also pinned in `.tool-versions` and `.nvmrc` where applicable.

### Accounts & identifiers

- Apple Developer account (for iOS signing + App Store Connect)
- Google Play Console account
- Bundle id / application id: `io.amban.app`
- URL scheme: `amban://`
- Domain: `amban.io`

---

## Getting Started

```sh
# 1. Clone
git clone <repo-url>
cd amban.io

# 2. Install dependencies (the web/JS side)
npm install

# 3. Run in the browser for fast iteration
npm run dev

# 4. Run on a device/simulator (after Phase 1 lands)
npm run build && npx cap sync
npx cap run ios        # iOS simulator or connected device
npx cap run android    # Android emulator or connected device
```

The app is local-only. There is no `.env`, no API keys, no backend to stand up.

---

## Project Layout

```
amban.io/
├── CLAUDE.md          # Product spec
├── ROADMAP.md         # Execution plan
├── README.md          # You are here
└── src/               # Scaffolded in Phase 1 per CLAUDE.md §4
    ├── db/            # SQLite schema, migrations, repositories
    ├── stores/        # Zustand stores
    ├── hooks/         # useAmbanScore, useInsights, useNotifications
    ├── screens/       # Onboarding, Home, Log, Insights, Settings, Profile
    ├── components/    # UI primitives + layout
    ├── utils/         # scoring, dateHelpers, formatters, insightGenerators
    └── constants/     # categories, insightThresholds
```

---

## Working Agreements

### Branching

Trunk-based. Short-lived feature branches, merged into `main` via PR. `main` is always green and always shippable.

- Branch names: `phase-<n>-<short-slug>` (e.g. `phase-3-sqlite-repo`) or `fix/<slug>` / `chore/<slug>`.
- Never push directly to `main`.
- Rebase, don't merge, when catching up a feature branch.

### Commits

[Conventional Commits](https://www.conventionalcommits.org/) format:

```
feat(score): add days-left clamp for income-day-is-today case
fix(notifications): cancel full ID range before rescheduling
chore(deps): bump capacitor to 6.1.2
docs(roadmap): clarify phase 5 exit criteria
```

Types used: `feat`, `fix`, `chore`, `docs`, `refactor`, `perf`, `style`, `build`, `ci`.

Scope is the subsystem (e.g. `score`, `onboarding`, `db`, `notifications`, `insights`, `ui`). Keep subjects under 72 characters. Body is optional but welcome for anything non-obvious.

### Pull Requests

Every PR must:

1. Link the phase or issue it belongs to.
2. Describe the change in one paragraph.
3. List any spec deviations with a justification (or update the spec instead).
4. Pass typecheck, lint, and build in CI.

No PR merges with failing checks. No PR merges with `TODO` or `FIXME` comments — convert them to tracked issues first.

### Code Style

- TypeScript strict mode. No `any` in committed code; use `unknown` plus a narrow if you truly don't know the shape.
- Prettier for formatting, ESLint for correctness. Pre-commit hooks run both via Husky + lint-staged.
- File naming: `PascalCase.tsx` for React components, `camelCase.ts` for everything else.
- One React component per file. Co-locate component-specific styles as `Component.module.css`.
- Prefer pure functions in `utils/`. UI talks to stores, stores talk to the repository layer, repositories talk to SQLite. Do not shortcut the layers.

### Privacy-as-Code

amban.io makes one promise: nothing leaves the device. Enforce it in code review:

- No `fetch`, no `XMLHttpRequest`, no WebSockets at runtime.
- No analytics SDKs, no crash reporters, no remote config.
- Fonts and icons are self-hosted. No CDN imports.
- A CI check (added in Phase 2+) fails the build if a forbidden symbol appears in the bundle.

If you ever have a reason to reach the network, raise it as a spec change first.

---

## One-Touch Dev

A single command should get a new contributor to a running app:

```sh
npm run setup
```

This will (once Phase 1 lands) install dependencies, run the Capacitor sync, and print next steps for native builds. Until then, `npm install && npm run dev` is the equivalent.

---

## Quality Gates

| Gate | Command | When |
|---|---|---|
| Typecheck | `npm run typecheck` | Pre-commit, CI |
| Lint | `npm run lint` | Pre-commit, CI |
| Build | `npm run build` | CI |
| Format check | `npm run format:check` | CI |

All four must pass before merging to `main`.

---

## License

[GNU General Public License v3.0 or later](./LICENSE). Copyleft terms apply to anyone who forks and redistributes amban.io in source or binary form — modifications must be made available under the same license.

---

## Contributing

This is currently a solo-led project. External contributions aren't being accepted yet. If that changes, contribution guidelines will land in `CONTRIBUTING.md`.

---

*When in doubt, ship simpler.*