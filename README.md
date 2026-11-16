# Quantech ID Studio

A browser-based ID card design and bulk generation tool. The workspace opens to a local project library with project previews, saved layouts, and quick creation options. Opening a project takes you into the existing card editor.

## Development

Requirements: Node.js 20 or newer.

```sh
npm install
npm run dev
```

Build and preview the production bundle:

```sh
npm run build
npm run preview
```

The site is a React + TypeScript + Vite application. The current editor is retained in `public/editor.html` while the workspace shell and local project library are migrated. Workspace projects and layouts are stored in IndexedDB. On first launch, the app imports legacy project and layout records from browser `localStorage` without deleting the originals.

## Product direction

- Keep the current editor appearance and canvas interaction model.
- Use a Figma/Adobe-informed home screen for finding recent work, projects, and reusable layouts, while extending the editor's existing dark design tokens.
- Stay on Vercel for the initial migration.
- Keep persistence local-first. Clerk sign-in and Supabase cloud sync are planned follow-on phases and are not configured yet.

See [the scaling implementation plan](docs/SCALING_IMPLEMENTATION_PLAN.md) and [starter-screen design notes](docs/DESIGN_REFERENCES.md).

Phase 3 auth and cloud setup is documented in [the Clerk/Supabase setup guide](docs/PHASE_3_CLOUD_SETUP.md). Local-only use remains available without provider keys.
