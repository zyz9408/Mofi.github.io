import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

const compressedBuilderStart = html.indexOf('async function createKodBackupPayload');
const compressedBuilderEnd = html.indexOf('function putBackupWithProgress', compressedBuilderStart);
const compressedBuilder = html.slice(compressedBuilderStart, compressedBuilderEnd);

assert.ok(compressedBuilderStart > 0 && compressedBuilderEnd > compressedBuilderStart);
assert.match(compressedBuilder, /new CompressionStream\(['"]gzip['"]\)/);
assert.match(compressedBuilder, /primaryKeys\(\)/);
assert.match(compressedBuilder, /bulkGet\(batchKeys\)/);
assert.match(compressedBuilder, /writeBufferLimit\s*=\s*512\s*\*\s*1024/);
assert.doesNotMatch(
  compressedBuilder,
  /\.toArray\(\)|JSON\.stringify\(backupData/,
  '压缩备份不能先把所有记录聚合成一份完整 JSON',
);

assert.match(html, /new DecompressionStream\(['"]gzip['"]\)/);
assert.match(html, /extension:\s*supportsGzip\s*\?\s*['"]\.json\.gz['"]/);
assert.match(html, /id="kod-backup-progress-panel"/);
assert.match(html, /function updateKodBackupProgress/);
assert.match(html, /formatKodBackupBytes\(loaded\)/);
assert.match(html, /formatKodBackupDuration\(eta\)/);

const startupTail = html.slice(html.indexOf('// ▼▼▼ 自动备份到 KOD 云'));
assert.match(startupTail.slice(0, 1800), /KOD_AUTO_BACKUP_INTERVAL/);
assert.match(startupTail.slice(0, 1800), /lastSuccessfulKodBackupAt/);
assert.match(startupTail, /KOD_AUTO_BACKUP_CHECK_INTERVAL\s*=\s*15\s*\*\s*60\s*\*\s*1000/);
assert.match(startupTail, /visibilitychange/);
assert.match(startupTail, /pageshow/);
assert.match(startupTail, /addEventListener\(['"]online['"]/);
assert.match(startupTail, /lastKodBackupAttemptAt/);
assert.match(startupTail, /scheduleAutoKodBackupCheck\(['"]页面启动['"],\s*30000\)/);

console.log('iOS data-transfer regression checks passed');
