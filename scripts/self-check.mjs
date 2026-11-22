import assert from 'node:assert/strict';
import fs from 'node:fs';

console.log('Running Quantech ID Studio configuration & logic checks...');

// 1. Verify vercel.json rewrite regex allows static assets through and catches SPA routes
const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
assert.ok(vercel.rewrites && vercel.rewrites.length > 0, 'vercel.json must have rewrites');
assert.ok(vercel.headers && vercel.headers.length >= 4, 'vercel.json must have static cache headers');

const regex = new RegExp(`^${vercel.rewrites[0].source}$`);
assert.strictEqual(regex.test('/projects/abc-123'), true, 'SPA route /projects/:id must match rewrite');
assert.strictEqual(regex.test('/layouts'), true, 'SPA route /layouts must match rewrite');
assert.strictEqual(regex.test('/vendor/xlsx.full.min.js'), false, 'vendor assets must NOT match SPA rewrite');
assert.strictEqual(regex.test('/assets/index-123.js'), false, 'assets must NOT match SPA rewrite');
assert.strictEqual(regex.test('/editor.html'), false, 'editor.html must NOT match SPA rewrite');

// 2. Verify package.json engines and dependencies
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.ok(pkg.engines && pkg.engines.node, 'package.json must specify node engines');
assert.strictEqual(pkg.dependencies.jspdf, undefined, 'jspdf npm package should be pruned');
assert.strictEqual(pkg.dependencies.xlsx, undefined, 'xlsx npm package should be pruned');

// 3. Verify public vendor files still exist physically
assert.ok(fs.existsSync('public/vendor/jspdf.umd.min.js'), 'public vendor jspdf must exist');
assert.ok(fs.existsSync('public/vendor/xlsx.full.min.js'), 'public vendor xlsx must exist');
assert.ok(fs.existsSync('public/vendor/jszip.min.js'), 'public vendor jszip must exist');
assert.ok(fs.existsSync('public/vendor/qrcode.min.js'), 'public vendor qrcode must exist');

// 4. Verify supabase config.toml exists
assert.ok(fs.existsSync('supabase/config.toml'), 'supabase config.toml must exist');

// 5. Verify QIDS Smart Bundle Fixtures
const { validateQidsBundle } = await import('./test-bundle-fixtures.mjs');
const clean = await validateQidsBundle('test-fixtures/qids/clean_10A.qids');
assert.strictEqual(clean.valid, true);
assert.strictEqual(clean.photoErrors.length, 0);

const retake = await validateQidsBundle('test-fixtures/qids/retake_10A.qids');
assert.strictEqual(retake.valid, true);
assert.strictEqual(retake.photoErrors.length, 0);

const corrupted = await validateQidsBundle('test-fixtures/qids/corrupted_10A.qids');
assert.strictEqual(corrupted.valid, true);
assert.strictEqual(corrupted.photoErrors.length, 2);

console.log('✅ All self-checks passed successfully!');
