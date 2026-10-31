"""Contract extraction regressions; no application imports or database access."""
import json
import unittest
from pathlib import Path
from contract_introspection import auth_policy, input_contract

ROOT = Path(__file__).resolve().parents[3]

def endpoint_source(filename, function):
    fixture = Path(__file__).with_name('legacy-contract-functions.json')
    return json.loads(fixture.read_text(encoding='utf8'))['functions'][filename + ':' + function]

class ContractIntrospectionTests(unittest.TestCase):
    def test_marker_helper_requires_admin(self):
        for name in ('update_marker','delete_marker'):
            source=endpoint_source('flask_server/app/metamuseum/views/marker_views.py',name)
            self.assertEqual(auth_policy(source,'marker.'+name,'/marker/<marker_id>'),'admin helper require_admin; JSON 403')

    def test_payload_attributes_subscripts_membership_and_loop_fields(self):
        source=endpoint_source('flask_server/app/metamuseum/views/main_views.py','update_element')
        expressions,fields=input_contract(source)
        self.assertIn('request.json',expressions)
        self.assertIn("data['position_x']",expressions)
        self.assertIn("'position_x' in data",expressions)
        self.assertTrue({'position_x','position_y','scale_x','rotation_z','cutout_position'}<=set(fields))
        source=endpoint_source('flask_server/app/metamuseum/views/marker_views.py','update_marker')
        expressions,fields=input_contract(source)
        self.assertIn('request.json',expressions)
        self.assertIn('data[field]',expressions)
        self.assertTrue({'name','is_active','target_position_x','offset_z','target_preset_id'}<=set(fields))

    def test_admin_static_is_public(self):
        self.assertEqual(auth_policy('', 'admin.static','/kwanri/static/<path:filename>'),'public static file')

if __name__=='__main__':unittest.main()
