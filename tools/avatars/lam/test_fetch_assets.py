import hashlib
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import fetch_assets


class AssetDownloadTests(unittest.TestCase):
    def test_download_installs_only_integrity_verified_bytes(self):
        payload = b'local fixture'
        entry = ('fixture/repo','revision','fixture.bin',len(payload),hashlib.sha256(payload).hexdigest())
        for good in [True, False]:
            with tempfile.TemporaryDirectory() as directory:
                response = io.BytesIO(payload if good else b'x'*len(payload))
                response.status, response.headers = 200, {}
                with patch.object(fetch_assets,'ROOT',Path(directory)), patch.object(fetch_assets,'urlopen',return_value=response):
                    if good:
                        self.assertEqual(fetch_assets.download(entry).read_bytes(),payload)
                    else:
                        with self.assertRaises(ValueError): fetch_assets.download(entry)
                        self.assertFalse((Path(directory)/'cache/fixture.bin').exists())


if __name__ == '__main__': unittest.main()
