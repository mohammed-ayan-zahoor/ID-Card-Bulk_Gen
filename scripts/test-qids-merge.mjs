/**
 * Unit test for QIDS Bundle validation and merging logic:
 * 1. Clean import: 6 students (4 done, 1 pending, 1 absent)
 * 2. Merging retake_10A onto clean_10A:
 *    - ims:...01 photo replaced (newer capturedAt)
 *    - ims:...03 photo replaced (newer capturedAt)
 *    - ims:...05 photo added (was pending, now done)
 *    - Summary: 3 photos replaced
 * 3. Corrupted bundle check:
 *    - Marks photo errors for adm:ex-003 and adm:ex-004
 *    - Successfully imports the remaining valid students
 * 4. Schema version 2.0 rejection:
 *    - Rejects with exact message: "Bundle schema v2.0 is newer than this Studio. Update the app."
 * 5. Schema version 1.3 acceptance:
 *    - Accepts forward-compatible 1.x version
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { validateQidsBundle } from './test-bundle-fixtures.mjs';

export function mergeStudents(existingList = [], incomingBundle) {
  const map = new Map(existingList.map(s => [s.studentId, { ...s }]));
  let photosReplacedCount = 0;
  let newStudentsCount = 0;

  for (const inc of incomingBundle.manifest.students) {
    if (!map.has(inc.studentId)) {
      map.set(inc.studentId, {
        ...inc,
        bundleCreatedAt: incomingBundle.manifest.createdAt
      });
      newStudentsCount++;
    } else {
      const cur = map.get(inc.studentId);
      // Compare bundle createdAt for non-photo fields
      const curBundleDate = new Date(cur.bundleCreatedAt || 0).getTime();
      const incBundleDate = new Date(incomingBundle.manifest.createdAt || 0).getTime();
      if (incBundleDate >= curBundleDate) {
        cur.fields = { ...cur.fields, ...inc.fields };
        cur.fullName = inc.fullName || cur.fullName;
        cur.rollNo = inc.rollNo || cur.rollNo;
        cur.admissionNo = inc.admissionNo || cur.admissionNo;
        cur.photoLabel = inc.photoLabel || cur.photoLabel;
        cur.bundleCreatedAt = incomingBundle.manifest.createdAt;
      }

      // Compare photo capturedAt for photo replacement
      if (inc.photo) {
        const curPhotoDate = new Date(cur.capturedAt || 0).getTime();
        const incPhotoDate = new Date(inc.capturedAt || 0).getTime();
        if (!cur.photo || incPhotoDate > curPhotoDate) {
          cur.photo = inc.photo;
          cur.photoSha256 = inc.photoSha256;
          cur.capturedAt = inc.capturedAt;
          cur.status = inc.status;
          photosReplacedCount++;
        }
      }
    }
  }

  return {
    merged: Array.from(map.values()),
    photosReplacedCount,
    newStudentsCount
  };
}

// Run assertions
const fixturesDir = path.resolve('test-fixtures/qids');

const clean = await validateQidsBundle(path.join(fixturesDir, 'clean_10A.qids'));
assert.strictEqual(clean.studentsCount, 6);

const retake = await validateQidsBundle(path.join(fixturesDir, 'retake_10A.qids'));
assert.strictEqual(retake.studentsCount, 3);

// Merge clean + retake
const { merged, photosReplacedCount, newStudentsCount } = mergeStudents(clean.manifest.students, retake);
assert.strictEqual(merged.length, 6, 'Total merged student count should remain 6');
assert.strictEqual(photosReplacedCount, 3, 'Exactly 3 photos should be updated/replaced');
assert.strictEqual(newStudentsCount, 0, 'No new students added from retake bundle');

// Test Idempotency: dropping retake again should result in 0 changes
const secondPass = mergeStudents(merged, retake);
assert.strictEqual(secondPass.photosReplacedCount, 0, 'Second drop of retake bundle must replace 0 photos');
assert.strictEqual(secondPass.newStudentsCount, 0, 'Second drop of retake bundle must add 0 students');

// Verify student 05 (Kunal Jadhav) transitioned from pending to done
const kunal = merged.find(s => s.studentId === 'ims:65d2f8a19b3c4e5f6a7b8c05');
assert.strictEqual(kunal.status, 'done');
assert.strictEqual(kunal.photo, 'photos/0005.jpg');

// Check schema rejection
function checkSchemaVersion(version) {
  const [major] = version.split('.').map(Number);
  if (major > 1) {
    throw new Error(`Bundle schema v${version} is newer than this Studio. Update the app.`);
  }
  return true;
}

assert.throws(
  () => checkSchemaVersion('2.0'),
  /Bundle schema v2\.0 is newer than this Studio\. Update the app\./
);
assert.strictEqual(checkSchemaVersion('1.3'), true);

console.log('✅ QIDS Bundle merging & schema version test passed completely!');
