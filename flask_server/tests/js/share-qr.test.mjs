import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const shareQrUrl = new URL('../../app/metamuseum/static/js/share-qr.js', import.meta.url);

async function loadShareUrlBuilder() {
  const source = await readFile(shareQrUrl, 'utf8');
  const window = { QRCode: true };
  vm.runInNewContext(source, { URLSearchParams, window, document: {} });
  return window.buildShareRoomUrl;
}

test('shared room URL omits an ignored avatar query parameter', async () => {
  const buildShareRoomUrl = await loadShareUrlBuilder();

  assert.equal(
    buildShareRoomUrl({
      protocol: 'https:',
      host: 'example.test',
      search: '?room_id=abc&avatar=robot',
    }),
    'https://example.test/room?room_id=abc',
  );
});
