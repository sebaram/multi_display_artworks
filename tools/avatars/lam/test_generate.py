from types import SimpleNamespace
from pathlib import Path
import json
import tempfile
import unittest
from generate import load_checkpoint, write_json


class CheckpointTests(unittest.TestCase):
    def test_manifest_replacement_preserves_previous_file_on_write_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'manifest.json'
            write_json(path, {'complete': True})
            with self.assertRaises(TypeError): write_json(path, {'invalid': object()})
            self.assertEqual(json.loads(path.read_text()), {'complete': True})

    def test_only_the_derived_joint_regressor_may_be_missing(self):
        for missing, unexpected, okay in [
            (['renderer.flame_model.J_regressor_up'], [], True),
            ([], [], True), (['encoder.model.weight'], [], False),
            ([], ['unknown.weight'], False),
        ]:
            model = SimpleNamespace(load_state_dict=lambda state, strict: SimpleNamespace(
                missing_keys=missing, unexpected_keys=unexpected))
            if okay:
                load_checkpoint(model, {})
            else:
                with self.assertRaises(RuntimeError): load_checkpoint(model, {})


if __name__ == '__main__': unittest.main()
