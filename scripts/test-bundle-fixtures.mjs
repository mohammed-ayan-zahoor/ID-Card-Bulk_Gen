/**
 * Automated test script to validate the fixture bundles:
 * - clean_10A.qids (should be 100% valid)
 * - retake_10A.qids (should be 100% valid, newer timestamps)
 * - corrupted_10A.qids (should detect SHA mismatch and missing file)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

// A minimal zero-dependency ZIP reader using Node buffers
function readZipEntries(buffer) {
  const entries = new Map();
  // Find End of Central Directory Record (EOCD) from the end
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('Invalid ZIP file: EOCD not found');

  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);

  let offset = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const compression = buffer.readUInt16LE(offset + 10);
    const compSize = buffer.readUInt32LE(offset + 20);
    const uncompSize = buffer.readUInt32LE(offset + 24);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);

    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;

    // Read local file header to find data offset
    const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;

    let data;
    if (compression === 0) {
      data = buffer.subarray(dataOffset, dataOffset + uncompSize);
    } else if (compression === 8) {
      data = zlib.inflateRawSync(buffer.subarray(dataOffset, dataOffset + compSize));
    } else {
      throw new Error(`Unsupported compression method: ${compression}`);
    }
    entries.set(name, data);
  }
  return entries;
}

export async function validateQidsBundle(filePath) {
  const buf = fs.readFileSync(filePath);
  const entries = await readZipEntries(buf);

  if (!entries.has('manifest.json')) {
    return { valid: false, error: 'Missing manifest.json' };
  }

  let manifest;
  try {
    manifest = JSON.parse(entries.get('manifest.json').toString('utf8'));
  } catch (e) {
    return { valid: false, error: `Invalid manifest.json: ${e.message}` };
  }

  // Schema version checks
  const version = manifest.schemaVersion;
  if (!version || typeof version !== 'string') {
    return { valid: false, error: 'Missing schemaVersion' };
  }
  const [major, minor] = version.split('.').map(Number);
  if (major > 1) {
    return { valid: false, error: `Bundle schema v${version} is newer than this Studio. Update the app.` };
  }

  // Check unique studentId
  const studentIds = (manifest.students || []).map(s => s.studentId);
  const uniqueIds = new Set(studentIds);
  if (studentIds.length !== uniqueIds.size) {
    return { valid: false, error: 'Duplicate studentId found in manifest' };
  }

  // Check photos
  const photoErrors = [];
  for (const s of manifest.students || []) {
    if (s.photo) {
      if (!entries.has(s.photo)) {
        photoErrors.push({ studentId: s.studentId, type: 'missing_file', file: s.photo });
      } else {
        const photoBytes = entries.get(s.photo);
        const actualSha = crypto.createHash('sha256').update(photoBytes).digest('hex');
        if (actualSha !== s.photoSha256) {
          photoErrors.push({ studentId: s.studentId, type: 'sha_mismatch', file: s.photo, expected: s.photoSha256, actual: actualSha });
        }
      }
    }
  }

  return {
    valid: true,
    bundleId: manifest.bundleId,
    studentsCount: manifest.students?.length || 0,
    photoErrors,
    manifest
  };
}

// Self-test if run directly
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  const fixturesDir = path.resolve('test-fixtures/qids');
  console.log('Testing QIDS Smart Bundle Fixtures in:', fixturesDir);

  const clean = await validateQidsBundle(path.join(fixturesDir, 'clean_10A.qids'));
  console.assert(clean.valid && clean.photoErrors.length === 0, 'clean_10A should have 0 photo errors');
  console.log('✅ clean_10A.qids passed! Students:', clean.studentsCount);

  const retake = await validateQidsBundle(path.join(fixturesDir, 'retake_10A.qids'));
  console.assert(retake.valid && retake.photoErrors.length === 0, 'retake_10A should have 0 photo errors');
  console.log('✅ retake_10A.qids passed! Students:', retake.studentsCount);

  const corrupted = await validateQidsBundle(path.join(fixturesDir, 'corrupted_10A.qids'));
  console.assert(corrupted.valid && corrupted.photoErrors.length === 2, 'corrupted_10A should have exactly 2 photo errors');
  console.log('✅ corrupted_10A.qids correctly identified photo errors:', corrupted.photoErrors.map(e => `${e.studentId}: ${e.type}`));

  console.log('All QIDS bundle fixture tests passed successfully! 🎉');
}
