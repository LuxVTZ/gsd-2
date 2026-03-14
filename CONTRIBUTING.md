# Contributing to GSD

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Development Setup

### Prerequisites

- **Node.js** ≥ 20.6.0
- **Git**
- **npm** (comes with Node.js)
- Optional: Rust toolchain (for native addon)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/gsd-build/gsd-2.git
cd gsd-2

# Install dependencies
npm install

# Build everything
npm run build

# Run tests
npm test

# Start dev mode (watch for changes)
npm run dev
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Full production build |
| `npm run dev` | Watch mode (TypeScript + resources) |
| `npm test` | Run unit + integration tests |
| `npm run test:unit` | Run unit tests only |
| `npm run lint` | Run ESLint |
| `npm run format` | Check code formatting (Prettier) |
| `npm run format:fix` | Auto-fix formatting |

## Code Style

- **TypeScript** with strict mode enabled
- **Tabs** for indentation
- **Double quotes** for strings
- **Semicolons** required
- **120 character** line width
- Run `npm run lint` before committing

ESLint and Prettier configs are at the project root. Your editor should pick up `.editorconfig` automatically.

## Project Structure

```
gsd-2/
├── src/                          # Main source
│   ├── cli.ts                    # CLI entry point
│   ├── resources/extensions/     # Extension modules (auto-discovered)
│   └── tests/                    # Top-level tests
├── packages/                     # Workspace packages (@gsd/*)
│   ├── pi-ai/                    # AI provider abstraction
│   ├── pi-tui/                   # Terminal UI
│   ├── pi-agent-core/            # Agent core
│   ├── pi-coding-agent/          # Coding agent logic
│   └── native/                   # Rust native addon
├── native/                       # Rust source (grep, parser)
└── docs/                         # Documentation
    └── extending-pi/             # Extension development guide (25 chapters)
```

## Writing Extensions

GSD has a powerful extension system. See `docs/extending-pi/` for the full guide covering:

- Extension lifecycle and discovery
- Custom tools, commands, and UI components
- State management and persistence
- System prompt modification
- Error handling best practices

Quick start: create a directory under `src/resources/extensions/` with an `index.ts` that exports a default function accepting `ExtensionAPI`.

## Testing

We use Node.js built-in test runner (`node:test`):

```typescript
import test from "node:test";
import assert from "node:assert/strict";

test("my feature works", () => {
  assert.equal(actual, expected);
});
```

- Tests go in `src/tests/*.test.ts` or `src/resources/extensions/gsd/tests/*.test.ts`
- Use real temp directories for git integration tests (`mkdtempSync`)
- Mock `globalThis.fetch` for HTTP tests
- No external mocking libraries — use manual stubs with `as any`

## Pull Request Process

1. **Branch** from `main` with a descriptive name: `feat/my-feature`, `fix/bug-description`, `refactor/area`
2. **Make changes** — keep commits atomic and well-described
3. **Test** — run `npm run build && npm test` to verify nothing breaks
4. **Lint** — run `npm run lint` to check for issues
5. **Push** and open a PR with a clear description
6. **Review** — address feedback promptly

### Commit Message Format

Use conventional commits:
- `feat:` — new feature
- `fix:` — bug fix
- `refactor:` — code restructuring (no behavior change)
- `test:` — adding/updating tests
- `build:` — build system changes
- `docs:` — documentation only
- `security:` — security fixes

## Reporting Issues

- Use the **Bug Report** template for bugs
- Use the **Feature Request** template for new ideas
- Include reproduction steps, expected vs actual behavior, and environment details

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
