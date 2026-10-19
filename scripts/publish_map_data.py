#!/usr/bin/env python3
"""Generate distances and prepare a versioned publication from data/map.json.

This only writes local files. Commit and deploy cf23-data to make it live.
"""
import argparse
import hashlib
import json
from pathlib import Path

from generate_booth_proximity import generate


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n'


def publish(destination: Path, project: Path) -> dict:
    layout = json.loads((project / 'data/map.json').read_bytes())
    proximity = generate(project / 'data/map.json')
    payload = {'layout': layout, 'proximity': proximity}
    fingerprint = hashlib.sha256(encode(payload).encode('utf-8')).hexdigest()
    manifest_path = destination / 'manifest.json'
    manifest = json.loads(manifest_path.read_bytes()) if manifest_path.exists() else {'schemaVersion': '1.0.0'}
    previous = manifest.get('map')
    version = 1
    if previous:
        version = previous['version']
        if previous.get('fingerprint') != fingerprint:
            version += 1
    snapshot = {'version': version, **payload}
    snapshot_hash = hashlib.sha256(encode(snapshot).encode('utf-8')).hexdigest()
    snapshot_path = f'maps/{snapshot_hash}.json'
    target = destination / snapshot_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(encode(snapshot), encoding='utf-8', newline='\n')
    descriptor = {'version': version, 'path': snapshot_path, 'fingerprint': fingerprint}
    manifest['map'] = descriptor
    # Write the pointer only after its complete immutable snapshot exists.
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n',
                             encoding='utf-8', newline='\n')
    return descriptor


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    args = parser.parse_args()
    project = Path(__file__).resolve().parent.parent
    result = publish(project / 'public', project)
    print(f"Prepared map version {result['version']}: {result['path']}")
