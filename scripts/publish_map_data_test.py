import json
from pathlib import Path
import tempfile
import unittest

from publish_map_data import publish


class MapPublicationTest(unittest.TestCase):
    def test_repeat_publish_is_stable_and_rollback_does_not_overwrite_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'data').mkdir()
            public = root / 'public'
            public.mkdir()
            catalog_manifest = {'schemaVersion': '1.0.0', 'catalog': 'v1/catalog.json',
                                'fandomRegistry': 'v1/fandoms.json'}
            (public / 'manifest.json').write_text(json.dumps(catalog_manifest))

            def save(booth):
                (root / 'data/map.json').write_text(json.dumps([[booth, '']]))

            save('A-01')
            initial = publish(public, root)
            shared_manifest = json.loads((public / 'manifest.json').read_bytes())
            self.assertEqual(shared_manifest, {**catalog_manifest, 'map': initial})
            original = (public / initial['path']).read_bytes()
            snapshot = json.loads(original)
            self.assertEqual(snapshot['proximity']['booths'], ['A-1'])
            self.assertEqual(snapshot['proximity']['neighbors'], [[]])
            self.assertEqual(publish(public, root), initial)
            save('B-02')
            changed = publish(public, root)
            self.assertEqual(changed['version'], 2)
            save('A-01')
            rollback = publish(public, root)
            self.assertEqual(rollback['version'], 3)
            self.assertNotEqual(rollback['path'], initial['path'])
            self.assertEqual((public / initial['path']).read_bytes(), original)

    def test_invalid_source_cannot_replace_the_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'data').mkdir()
            (root / 'data/map.json').write_text('{}')
            with self.assertRaisesRegex(RuntimeError, 'Unsupported map JSON format'):
                publish(root / 'public', root)
            self.assertFalse((root / 'public/manifest.json').exists())

    def test_editing_semantic_map_recalculates_distances_without_other_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'data').mkdir()
            source = root / 'data/map.json'
            layout = {
                'schemaVersion': 2, 'bounds': {'width': 500, 'height': 300},
                'features': [
                    {'id': booth, 'kind': 'booth', 'geometry': {
                        'type': 'rect', 'x': x, 'y': 0, 'width': 10, 'height': 10,
                    }} for booth, x in [('A-01', 0), ('A-02', 15)]
                ],
            }
            source.write_text(json.dumps(layout))
            first = publish(root / 'public', root)
            first_snapshot = json.loads((root / 'public' / first['path']).read_bytes())
            self.assertEqual(first_snapshot['proximity']['neighbors'][0], [[1, 1]])
            layout['features'][1]['geometry']['x'] = 150
            source.write_text(json.dumps(layout))
            second = publish(root / 'public', root)
            second_snapshot = json.loads((root / 'public' / second['path']).read_bytes())
            self.assertEqual(second_snapshot['proximity']['neighbors'][0], [[1, 10]])
            self.assertEqual(second['version'], first['version'] + 1)
            self.assertNotEqual(first_snapshot['proximity']['map_sha256'],
                                second_snapshot['proximity']['map_sha256'])


if __name__ == '__main__':
    unittest.main()
