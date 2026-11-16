# Phase 3: Clerk and Supabase setup

Phase 3 adds optional Clerk sign-in and a per-user Supabase workspace repository. Signed-out users continue to use IndexedDB on the current device. Signing in selects the signed-in user's cloud workspace; it does not upload or remove the device's existing files. Explicit local-to-cloud migration is Phase 4.

## Provider setup

1. Create a Clerk application. Configure its sign-in methods and add the local and deployed app origins in Clerk's allowed origins/redirect settings.
2. Create a Supabase project.
3. In Clerk, use **Connect with Supabase** to configure Clerk-issued sessions for Supabase. In the Supabase project, add Clerk under **Authentication → Sign In / Providers → Third-Party Auth**. Use this current first-party third-party-auth integration; do not use the old shared JWT-secret/template setup.
4. Apply [`supabase/migrations/20261116000000_phase3_cloud_workspace.sql`](../supabase/migrations/20261116000000_phase3_cloud_workspace.sql) to the Supabase project. The SQL creates a user-owned document table, enables RLS, and creates private buckets/policies for workspace files. Object paths must start with the Clerk user ID.
5. Copy `.env.example` to `.env.local` for local development. Fill in Clerk's **publishable** key, the Supabase Project URL, and the Supabase **publishable** key.
6. In Vercel, add the matching Clerk live publishable key and Supabase public project values to **Preview** first. Deploy the feature branch, verify sign-in and create/read/rename/delete with two separate test users, then add the Production values after review. Environment variable changes require a new deployment.

| Variable | Source | Browser-exposed? |
| --- | --- | --- |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk Dashboard → API Keys | Yes; designed for frontend use |
| `VITE_SUPABASE_URL` | Supabase Project Settings → API | Yes |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase Project Settings → API Keys | Yes; publishable key only |

Never add Clerk secret keys or Supabase secret/service-role keys to Vite variables or source code. Vite embeds variables prefixed with `VITE_` in the client bundle. Supabase authorization relies on the user's Clerk token and RLS, not a privileged backend key.

## Current behavior and limits

- No provider keys are required to run or host the local workspace. With no Clerk key, sign-in UI is omitted and IndexedDB remains active.
- With Clerk configured but Supabase values absent, the app can sign in but continues to save to the local device and labels that state.
- With Clerk and Supabase configured, new edits and CRUD operations go to the authenticated user's cloud workspace. RLS derives ownership from the Clerk token's `sub` claim.
- Existing IndexedDB/localStorage content stays on the device. There is no automatic upload. Phase 4 adds an explicit, reviewable migration flow.
- Project JSON is stored in the database. Private storage buckets and ownership policies are prepared for assets/previews; binary asset upload, account-wide export/deletion, and cleanup automation are not enabled in this phase.
- Verify isolation with two test accounts before using real customer data. A signed-in user must not be able to read, edit, or delete another user's rows or Storage objects.
