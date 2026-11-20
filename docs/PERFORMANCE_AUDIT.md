# Performance and scale audit

## Scope and assumptions

This review is based on the current source in `src/`, `public/editor.html`, and the Supabase migration. No production traces, user counts, or representative large documents were available, so the issues below are source-level findings rather than measured latency claims. “5,000 users” can mean 5,000 accounts over time or 5,000 simultaneous sessions; those have very different capacity needs. This code review can address the former’s client-side and query inefficiencies, but concurrency capacity needs live load data.

## Changes made in this pass

- IndexedDB is now opened once per tab and reused. The prior implementation opened and closed the database on every list, save, delete, and asset operation. A version change closes the cached connection cleanly.
- Opening a project by direct URL now queries that project by ID instead of downloading every project and searching in the browser. Local mode uses the IndexedDB primary key; cloud mode applies owner, kind, and ID filters.
- Cloud library reads explicitly filter on `owner_id` in addition to RLS, helping the database use the `(owner_id, kind, updated_at)` index.
- The one-time local migration runs alongside cloud reads after authentication, since they use independent stores.
- Editor polling moved from 900 ms to 1.5 seconds. State capture deep-clones placeholders and includes background data URLs, so the old cadence repeated large serialization work while idle. A visibility-change save remains in place.
- Cloud saves now upload large raster backgrounds and custom photo fields to the existing private Storage buckets, and write storage references into document JSON. Loads resolve references to short-lived signed URLs. Repeated autosaves in the same session reuse the uploaded asset. Failed record writes clean up newly uploaded objects.

## Findings and remaining work

### P0 — Large images are embedded in project JSON

Legacy rows and local drafts can still contain image data URLs, but new cloud saves externalize large backgrounds and custom photo fields. The library still fetches full document JSON, and existing assets move to Storage when that record is next saved. This remains a major scale and “stuck save” risk for large libraries or unsaved legacy documents.

**Next:** add a deliberate migration/backfill for existing cloud rows and local drafts, with progress and resume support. Define file-size/type limits and a ref-counted cleanup process. Asset cleanup on record deletion/replacement is deferred because duplicate projects/layouts can share object keys.

### P0 — Workspace lists fetch all full documents

`listProjects()` and `listLayouts()` select `document` for every record and return every row. This has no page size or summary query. It is tolerable for a small personal workspace but scales with each account’s record count and image size.

**Next:** add summary columns (name, orientation, preview key, updated time), query those for the gallery, add keyset pagination and load-more, and fetch the full document only on open. Preserve RLS and add an owner/kind/updated/id index matching the final cursor order.

### P1 — Autosave still performs whole-document work on a timer

Autosave calls `getDocumentState`, deep-clones all placeholders, stringifies backgrounds and placeholders to compare state, then writes the complete JSON document. The reduced cadence helps idle CPU, but the payload and serialization cost remain for large cards and frequent edits.

**Next:** emit a lightweight change revision from the editor when data changes, debounce saves from that signal, and avoid serializing unchanged binary data. Add a serialized save queue with retry/error visibility and conflict protection before supporting multiple tabs/devices.

### P1 — Editor is a 6,000-line legacy page and loads export/import libraries up front

`public/editor.html` is approximately 6,000 lines and loads XLSX, JSZip, jsPDF, and QR vendor scripts on every editor open, although several are only needed for particular actions. This increases editor startup cost and makes regressions harder to isolate.

**Next:** load XLSX on spreadsheet selection, jsPDF on PDF export, and JSZip on ZIP export; measure editor first-interaction time. Then extract state, rendering, persistence, and export into modules without changing card output. Move image processing and bulk rendering to Web Workers/OffscreenCanvas where browser support permits.

### P1 — Sign-in and workspace loading need timing/error instrumentation

The app waits for Clerk to load before workspace initialization. It has visible loading states, but no app-level timing data or categorized telemetry to tell whether a slow session is Clerk startup, project fetch, image transfer, or editor initialization. No error reporting or save latency instrumentation is visible in the inspected app code.

**Next:** record coarse timings for auth-ready, workspace summaries, project-open, first editor paint, and save completion; report anonymized counts/latencies and failures. Do not record card contents, names, or image data. Use the data to set targets (for example p50/p95) before optimizing auth or choosing infrastructure.

### P2 — Large galleries and expensive UI actions

The workspace keeps all projects/layouts in React state and filters/sorts them in the browser. At larger per-user libraries this raises transfer, memory, and render costs. Bulk card exports use canvas rendering, data URLs, and ZIP/PDF generation on the main thread; large batches can freeze the interface.

**Next:** pair summaries with pagination and list virtualization. Move batch exports into a worker, stream/download outputs where possible, and show progress/cancel controls. Test with realistic 100, 1,000, and large-image project sets.

### P2 — Reliability and recovery

The current cloud repository writes each autosave directly and has no visible offline queue, retry/backoff, or version conflict handling. A slow network can make save/navigation wait. Local browser storage is device/browser scoped and is not a cloud backup.

**Next:** keep a durable local draft, queue cloud writes, retry transient failures with bounded backoff, expose sync state, and define conflict behavior. Add export/restore and account deletion flows before relying on cloud-only records.

## Existing protections

- Supabase rows have per-user RLS policies and an owner/kind/updated index.
- Private Storage buckets and owner-path policies are already provisioned in the migration, although the application does not yet upload project assets there.
- Local legacy migration is non-destructive; it keeps the original browser storage entries.
- The application runs as a Vite static app, so increasing account count alone does not require a larger frontend server. Database query shape, storage bytes, egress, and simultaneous use should be measured before changing Supabase or Vercel plans.

## Suggested implementation order

1. Measure current login, library, open, save, and export timings with a representative account.
2. Move project images out of JSONB and add summary-only listing with cursor pagination.
3. Replace timer-based deep serialization with editor change signals and a queued, retryable save path.
4. Lazy-load editor vendor libraries; then profile and move batch work off the main thread.
5. Load-test realistic request/storage patterns and only then decide whether Supabase/Vercel capacity needs an upgrade.
