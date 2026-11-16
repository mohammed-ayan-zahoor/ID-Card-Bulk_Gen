# Scaling implementation plan

## Goal

Evolve the current single-file ID card generator into a maintainable web application with a Figma-inspired home screen, while preserving the existing editor’s visual design and direct-to-canvas workflow. Add accounts and cloud project storage as a later, opt-in capability using Clerk and Supabase.

This document records the staged implementation plan and current progress. Product scope is the browser application; desktop packaging is outside this plan.

## Implementation status

Phase 2 shipped on `main`; Phase 3 is in progress on `feature/phase-3-auth-cloud-foundation`:

- React + TypeScript + Vite shell replaces the direct single-HTML entry point.
- The existing editor is preserved as `public/editor.html` and opens from the project library through a same-origin bridge.
- A dark, compact workspace home now provides Recent, Projects, Layouts, search, preview cards, and blank horizontal/vertical creation.
- An IndexedDB repository stores projects/layouts and imports existing `localStorage` records non-destructively.
- Vercel SPA deep-link rewriting is configured.
- Optional Clerk sign-in and the Supabase cloud repository/RLS foundation are being implemented in Phase 3.
- Explicit local-to-cloud migration, binary asset upload, and the design-engine modular extraction remain future work.

Phase 2 local-library scope is implemented on this branch: blank project creation, orientation selection, IndexedDB projects/layouts, non-destructive legacy import, project actions, layout reuse, recent/project/library navigation, and editor autosave. The editor still runs as the preserved same-origin HTML application; extracting its engine is separate work.

## Design direction and reference research

Before implementing the new home screen, study the current Figma and Adobe desktop/web product experiences for patterns that fit this product: project discovery, recent files, template browsing, preview cards, creation flows, and dense creative-workspace navigation. Use those products as references for interaction and information architecture, not as screens to copy.

The visual system should grow from the existing canvas editor. First document its actual tokens and patterns: dark surfaces, accent color, typography, control sizing, spacing, borders, selection states, focus states, and information density. Then extend those same rules to the home screen so the library and editor feel like one product. Keep the editor appearance stable during the migration and avoid a generic marketing dashboard or gratuitous decoration.

Create a short design brief and home-screen wireframe/mock before building the page. Review it against the current editor screenshot and the Figma/Adobe reference notes. The first implementation stage should preserve existing editor styles and only add the minimum new components/tokens needed for the home screen.

## Product experience

### Home screen

- On entry, show a workspace home instead of immediately opening a blank card.
- Provide a prominent **Create new** action with blank horizontal and vertical CR-80 options.
- Present saved layouts as preview cards. Selecting one opens a new editable project based on that layout.
- Show recent projects and a browsable projects/files view with card thumbnails, names, orientation, last-edited time, and actions to open, rename, duplicate, or delete.
- Include search and useful filters as the library grows.
- Keep the editor reachable with one action from home; creating a blank card should open it immediately.
- Provide useful empty states for new users and for signed-in users without cloud projects.

### Editor

- Preserve the current editor layout, dark visual language, controls, and canvas interactions.
- Keep the current direct-to-canvas editing model once a project is opened.
- Add clear navigation back to the project library, with save/sync status and project name.
- Use project thumbnails and layout previews generated from the same rendering pipeline used by the editor where practical.

## Recommended application stack

- **React + TypeScript + Vite** for the app shell, home screen, routing, and UI modules.
- **Existing CSS and Tailwind utility styling** retained during migration. Move styles into maintained local files without redesigning them. Avoid a visual refresh as part of the migration.
- **Existing canvas renderer/editor logic** extracted behind a stable TypeScript API and hosted inside a React editor component. React should own navigation and surrounding UI; the canvas engine can continue to own pointer-heavy drawing and selection behavior initially.
- **IndexedDB** as the durable local store for projects, layouts, and offline asset blobs. Keep a repository interface so local and cloud persistence can evolve without coupling UI components to storage details.
- **Clerk** for identity and sign-in.
- **Supabase Postgres and private Storage** for synced project metadata, document JSON, uploaded assets, and previews.
- **Supabase Row Level Security (RLS)** on every user-owned table and Storage path. Configure Clerk-issued JWTs for Supabase access; never ship a Supabase service-role key to the browser.

React does not require recreating the current styling. The migration should use the existing markup/classes and compare screenshots during each editor integration step.

## Proposed application structure

```text
src/
  app/                 # App shell, routing, auth and workspace state
  features/
    library/            # Home, recent projects, layouts and project cards
    editor/             # React editor host and editor UI integration
    assets/             # Image/photo upload and asset references
    auth/               # Clerk integration and account states
  editor-engine/        # Extracted canvas model, rendering, selection and tools
  data/
    repositories/       # Project/layout local and cloud repository interfaces
    local/              # IndexedDB implementation and legacy localStorage import
    cloud/              # Supabase implementation and sync orchestration
  shared/               # Types, common controls and utilities
  styles/               # Existing styles migrated with minimal changes
```

Suggested primary routes:

- `/` — workspace home and project library.
- `/projects/:projectId` — editor for an existing project.
- `/new` or an equivalent route/state — create from blank or a layout, then enter the editor.

## Data model direction

- **Project:** owner, name, orientation, front/back design state, selected template/layout provenance, created/updated timestamps, thumbnail reference, sync metadata.
- **Layout:** owner or built-in status, name, front/back design state, orientation, preview reference, timestamps.
- **Asset:** owner, storage key, media type, size, dimensions where available, checksum, and reference count or cleanup metadata.
- **Project assets:** references from project fields/backgrounds to asset records, rather than embedding large image data in project rows.

Keep document content versioned (for example, `schemaVersion`) so future editor changes can migrate old projects safely. Do not store bulk roster data or generated card output in the project database unless a product requirement calls for it; define retention and privacy behavior for personal data before adding cloud persistence for those inputs.

## Delivery phases

### Phase 0 — Baseline and boundaries

1. Record current editor flows, storage keys, document/layout shapes, export behavior, and representative screenshots.
2. Identify and document the existing canvas/editor functions that need a stable API: load document, create blank/layout document, render preview, save snapshot, and export.
3. Research Figma and Adobe product patterns relevant to file discovery, recent work, templates, and creative-tool navigation; record what is useful and what should not be copied.
4. Derive a small design system from the existing canvas UI, then produce and review a home-screen wireframe/mock against that visual baseline.
5. Define supported browser targets and whether offline editing is a requirement.
6. Confirm privacy, retention, and account expectations for uploaded photos and roster data.
7. Confirm hosting before implementation deployment. Recommendation: keep the existing Vercel hosting for the first React/Vite release, then reconsider Cloudflare if measured delivery costs, traffic, or a Cloudflare-specific feature justifies migration.

**Exit criteria:** agreed document and layout types, UI baseline, reviewed home-screen direction, explicit local-first/cloud-sync behavior, and a hosting decision.

### Phase 1 — Extract the editor without changing its appearance

1. Create the React + TypeScript + Vite app shell and local development/build scripts.
2. Move the current styles and editor markup into source files with minimal edits; preserve existing class names and dimensions.
3. Extract the editor’s data model and canvas logic into modules. Replace implicit globals with an explicit editor API and typed state where practical.
4. Mount the editor engine inside a React editor host. Keep canvas drawing and complex pointer handling in the engine until there is a clear benefit to replacing them.
5. Keep the app opening directly into the editor during this phase to reduce simultaneous product and architecture changes.
6. Implement only against the reviewed design direction; preserve current canvas styling and interaction patterns.

**Exit criteria:** existing editor workflows and output remain visually and functionally equivalent; no redesign is bundled with the migration.

### Phase 2 — Local project library and starter screen

**Branch status: implemented; build and core flow verified.** The local library supports project and layout CRUD, recent ordering, search, grid/list views, legacy localStorage import, blank horizontal/vertical creation, and direct editor navigation. A blank project was created, returned to Recent, and reopened from its saved IndexedDB record. Editor saves are serialized with navigation so leaving during an in-flight autosave waits for the save to finish. A malformed legacy payload leaves the import marker unset and source data intact, allowing a later retry. Template galleries were removed from the product UI; new projects start blank, while saved layouts remain reusable.

1. Add the home route and **Create new** flow for blank horizontal/vertical cards.
2. Add a local project/layout repository backed by IndexedDB.
3. Import existing `localStorage` documents/layouts on first launch without deleting the source data until import succeeds.
4. Add project save, rename, duplicate, delete, open, recents, and thumbnail generation.
5. Build the Figma-inspired project and layout galleries using preview cards, search, filters, and useful empty states.
6. Add navigation between home and editor and preserve unsaved changes with explicit save/autosave behavior.

**Exit criteria:** users can create, reopen, and manage multiple local projects and layouts from home; existing local work is recoverable after migration.

### Phase 3 — Sign-in and cloud foundation

**In progress:** optional Clerk sign-in, per-user Supabase document repository, RLS schema, and private Storage bucket policies are implemented in the feature branch. Provider dashboard configuration and two-user live authorization verification are still required; see [Phase 3 setup](PHASE_3_CLOUD_SETUP.md).

1. Add Clerk sign-in/sign-up and account-aware navigation. Keep local, unsigned use possible unless product decisions explicitly require accounts.
2. Create Supabase schema and private Storage buckets for projects, layouts, previews, and assets.
3. Configure Clerk-to-Supabase third-party auth and enable RLS policies. Test that one user cannot read or mutate another user’s rows or files.
4. Add cloud repository implementations behind the same interfaces as local persistence.
5. Define ownership, deletion, account export, and asset cleanup behavior.

**Exit criteria:** authenticated users can safely create/read their own cloud records; authorization is enforced by RLS and Storage policies, not only by UI checks.

### Phase 4 — Sync and local-to-cloud migration

1. Add explicit **Sync this workspace** onboarding for local projects, with a review/selection step and clear explanation of what files will upload.
2. Upload referenced assets before publishing project records that point to them.
3. Track local/cloud IDs, timestamps, schema versions, upload status, and retryable errors.
4. Start with simple conflict behavior: last-write-wins for a single user/device, with a recoverable prior version or duplicate on detected simultaneous edits.
5. Add offline queue/retry behavior if offline support is part of the agreed product scope.
6. Provide account export and deletion flows before relying on cloud storage for customer work.

**Exit criteria:** a user can sign in on another device and see synced projects; interrupted sync can resume; local copies remain intact until verified cloud sync succeeds.

### Phase 5 — Scale and hardening

1. Measure library load, thumbnail creation, editor responsiveness, and large-batch export performance.
2. Move expensive image work and bulk export off the main UI thread where needed.
3. Add storage quotas, upload limits, pagination, and cleanup policies based on real use.
4. Add operational monitoring and clear recovery paths for failed saves/syncs.
5. Review personal-data handling, retention, backup, and access controls before broader release.

**Exit criteria:** performance and reliability targets are defined and met for representative project counts and batch sizes.

## Key decisions to make before cloud implementation

1. Is sign-in optional, or required for using the app? Recommended initial choice: optional, with sign-in required only for cloud sync.
2. Does “project” include imported student/employee rosters and source photos, or only reusable design and assets? This affects privacy and storage cost.
3. Should the app support offline editing and cross-device conflict recovery at launch?
4. What are the account deletion and data-retention rules?
5. Is a single-user workspace enough initially, or are teams and shared projects required?
6. Confirm hosting provider. The default recommendation is Vercel for continuity during the React/Vite migration; Cloudflare remains a viable alternative if future usage or platform needs make the switch worthwhile.

## Hosting recommendation

Keep the app on **Vercel initially**. It is already hosted there, and the proposed React + Vite app is supported by Vercel’s documented deployment flow, including Git-based preview deployments. Retaining it avoids adding a hosting migration to the same effort as the React conversion, editor extraction, starter screen, and cloud data work. Clerk and Supabase can be used independently of the frontend host.

Cloudflare is a credible option for a static Vite app, and its Pages documentation lists the standard `npm run build` / `dist` setup. Cloudflare’s current Pages documentation also points new application work toward Workers, so moving would involve a separate platform decision and deployment validation. Revisit the choice after collecting Vercel usage and cost data or if Cloudflare features such as Workers or R2 become a concrete requirement. Do not migrate hosts just for the React conversion.

## Main risks and mitigations

- **Editor regressions during migration:** migrate in phases, preserve the current visual baseline, and keep the canvas engine isolated from the React shell.
- **Loss of local work:** import local data non-destructively, version document schemas, and offer export/backup before cloud onboarding.
- **Cloud data exposure:** private buckets, RLS on all rows and Storage operations, least-privilege policies, and automated cross-user authorization checks.
- **Large embedded assets:** store blobs in Storage/IndexedDB and reference them from versioned project JSON.
- **Overbuilding sync too early:** deliver a local-first project library before accounts and cloud synchronization.
- **Losing the product’s visual identity:** ground the new page in the existing editor and researched creative-software patterns, then review a mock before implementation.
- **Changing too many foundations at once:** retain Vercel for the initial migration unless measured requirements justify a host change.

## Validation checklist for implementation

- Existing editor styling and card rendering remain consistent with baseline screenshots.
- Blank and layout-based creation both land directly in the editor.
- Projects and layouts survive refresh and local-storage migration.
- Thumbnails accurately represent the selected card design.
- Export behavior remains correct after moving to the React shell.
- Signed-out local workflows remain available if optional sign-in is selected.
- Cloud records and assets are isolated by user at the database and Storage policy layers.
- Sync failure, retry, duplicate/conflict, account export, and account deletion flows are understandable and recoverable.
