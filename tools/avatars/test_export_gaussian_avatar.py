import io
import pickle
import unittest

import numpy as np

import export_gaussian_avatar as exporter


class OpenConversionTests(unittest.TestCase):
    def test_restricted_loader_accepts_modern_numeric_arrays_but_not_globals(self):
        array = np.arange(12, dtype=np.float32).reshape(4, 3)
        restored = exporter.ModelUnpickler(io.BytesIO(pickle.dumps(array, protocol=5))).load()
        np.testing.assert_array_equal(restored, array)
        with self.assertRaises(pickle.UnpicklingError):
            exporter.ModelUnpickler(io.BytesIO(pickle.dumps(eval))).load()

    def test_open_coefficients_reproduce_a_known_change_of_expression_basis(self):
        rng = np.random.default_rng(306)
        open_basis = rng.normal(size=(40, 3, 100))
        transform = np.eye(100) * 2
        transform[0, 1] = .25
        original_basis = (open_basis.reshape(-1, 100) @ transform).reshape(40, 3, 100)
        original_coefficients = rng.normal(size=(3, 100))
        converted = exporter.convert_expressions(original_basis, open_basis, original_coefficients)
        np.testing.assert_allclose(converted, original_coefficients @ transform.T, atol=1e-10)
        np.testing.assert_allclose(converted @ open_basis.reshape(-1, 100).T,
            original_coefficients @ original_basis.reshape(-1, 100).T, atol=1e-10)

    def test_invalid_conversion_inputs_fail_before_export(self):
        basis = np.zeros((40, 3, 100))
        for bad in [np.zeros((2, 99)), np.full((2, 100), np.nan)]:
            with self.assertRaises(ValueError):
                exporter.convert_expressions(basis, basis, bad)


if __name__ == '__main__':
    unittest.main()
