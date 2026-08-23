```
rool-dev-cli/
├── package.json
├── tsconfig.json
├── tsup.config.ts                  # Bundler entry pointing to src/app/index.ts
├── dist/                           # Compiled output (generated on build)
│   └── index.js
└── src/
    └── app/                        # All application code lives here
        ├── index.ts                # Main CLI entrypoint & Commander routing
        ├── config.ts               # Local store/settings schema (Conf/paths)
        │
        ├── commands/               # CLI Command Handlers
        │   ├── auth.ts             # login, logout, status/whoami
        │   ├── git.ts              # Git automation tasks
        │   └── tasks.ts            # Embedded code runner & automation tasks
        │
        ├── lib/                    # Shared core utilities & engines
        │   ├── auth.ts             # Rool SDK client & credential manager
        │   ├── git.ts              # Git wrapper (simple-git/execa)
        │   └── runner.ts           # Embedded automation execution engine
        │
        └── ui/                     # CLI Styling & UX components
            ├── theme.ts            # Chalk colors, brands, icons
            ├── prompts.ts          # Interactive clack prompts & spinners
            └── layout.ts           # Boxen layouts & banner formatting
```