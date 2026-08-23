# rool-dev-cli

A CLI interface to work with Rool.dev AI for coding tasks — an interactive, terminal-based agent for asking questions, planning changes, and applying code edits directly to your local repository.

> **Disclaimer:** This is an independent, unofficial hobby project by a solo developer. It is **not affiliated with, endorsed by, or supported by Rool.dev or its parent company**. Rool.dev officially only ships their own app and browser-based tooling — this project exists purely as an experiment to see what it would take to build an unofficial CLI on top of their platform. Use at your own risk.

## Requirements

- [Node.js](https://nodejs.org/) 18 or later
- A [Rool](https://rool.dev) account (you'll sign in via browser on first use — no manual API key setup needed)
- Git (only required for the Git-related features: status, AI review, smart commit)

## Install

Clone the repo and set it up as a global command, similar to how you'd install GitHub Copilot CLI:

```bash
git clone <this-repo-url>
cd rool-dev-cli
npm install
npm run build
npm link
```

`npm link` registers the `rool-dev` command globally, so you can run it from any directory on your machine. Whenever you pull new changes or make edits to the CLI itself, just re-run `npm run build` — the linked command always points at the latest `dist/` output.

To uninstall the global command later: `npm unlink -g rool-dev-cli`.

## Quick start

Run it from inside any Git repository (or any folder) you want to work in:

```bash
rool-dev
```

The first time you run it, you'll be prompted to sign in — this opens your browser for authentication with Rool. After that, your session is cached locally and you won't need to log in again.

Running `rool-dev` with no arguments launches the **interactive shell**:

```
┌  Workspace: /path/to/your/project
│  Branch: main (clean) | Auth: ● In | ⚡ 1,240 cr
│
◆  Choose an action:
│  ● 🧠 Ask Rool (Code modification, tasks, questions)
│  ○ 🔍 AI Code Review (Inspect current diff & changes)
│  ○ 📝 AI Smart Commit (Analyze diff & generate commit)
│  ○ 📊 Usage & Balance
│  ○ 📊 Inspect Local Git Status
│  ○ 🧭 Resume / Select a conversation session
│  ○ 🔄 New Conversation (Clear Memory)
│  ○ 📂 Switch Active Folder / Repository
│  ○ 🤖 List Rool Machines
│  ○ 🔒 Manage Rool Auth (Logout/Relogin)
│  ○ ❌ Exit Session
```

From there, pick **🧠 Ask Rool** and type a prompt. Prefix it to control what the agent is allowed to do:

- `agent: <task>` (default) — the agent may propose and write file changes. You'll always see a diff and get asked to confirm before anything is written to disk.
- `ask: <question>` — answer-only, no code changes proposed.
- `plan: <task>` — produces a step-by-step implementation plan, no code changes proposed.

You can also reference files or folders directly in your prompt with `@path/to/file` to pull their live content into context.

## Non-interactive commands

For scripting or quick one-offs outside the interactive shell:

```bash
rool-dev auth login      # Sign in via browser
rool-dev auth status     # Check current authentication status
rool-dev auth logout     # Sign out and clear the local session

rool-dev git status      # Styled Git status for the current repo
```

## Configuration

There's nothing to hand-configure to get started — authentication and preferences (active machine, active conversation, etc.) are stored automatically in your OS's standard local app-data directory via [`conf`](https://github.com/sindresorhus/conf), keyed to `rool-dev-cli`. Use `rool-dev auth logout` to clear your session.

## Development

```bash
npm run dev     # tsup --watch, rebuilds on change
npm run start   # run the built CLI directly with node
```
