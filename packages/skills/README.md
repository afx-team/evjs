# @evjs/skills

AI agent skills for developing [evjs](https://github.com/evaijs/evjs) applications. Versioned alongside the framework packages.

## Install

### Via `npx skills` (recommended)

```bash
npx skills add evaijs/evjs
```

Auto-detects your AI agent (Claude, Cursor, Copilot) and installs skills into the right location.

### Via npm

```bash
npm install @evjs/skills --save-dev
```

Then point your agent to `node_modules/@evjs/skills/skills/`, or symlink:

```bash
ln -s node_modules/@evjs/skills/skills .agent/skills
```

## Available Skills

| Skill | Description |
|-------|-------------|
| `init` | Scaffold new evjs projects with `ev init` |
| `dev` | Development server architecture and configuration |
| `build` | Production build output and deployment |
| `server-functions` | Server functions, query proxies, middleware, and error handling |

## Skill Format

Each skill follows the [Vercel Agent Skills](https://github.com/vercel-labs/agent-skills) convention:

```
skills/
├── init/
│   └── SKILL.md          # YAML frontmatter (name, description) + instructions
├── dev/
│   └── SKILL.md
├── build/
│   └── SKILL.md
└── server-functions/
    └── SKILL.md
```
