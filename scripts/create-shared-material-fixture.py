"""Create a metadata-only shared-source mapping fixture with saved PNGs."""
from pathlib import Path
import json
import zipfile

source = Path('test/fixtures/plate-previews/valid.3mf')
target = Path('proof/material-mapping/shared.3mf')
config = '<config>' + ''.join(f'<plate><metadata key="plater_id" value="{n}"/><metadata key="plater_name" value="{name}"/><metadata key="thumbnail_file" value="Metadata/plate_{n}.png"/></plate>' for n, name in [(2, 'Part A, source 0'), (7, 'Part B, source 0'), (9, 'Part C, source 1')]) + '</config>'
with zipfile.ZipFile(source) as original:
    image = original.read('Metadata/plate_2.png')
with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as z:
    z.writestr('Metadata/model_settings.config', config)
    z.writestr('Metadata/project_settings.config', json.dumps({'filament_type': ['PETG', 'PETG'], 'filament_colour': ['#B44235', '#B44235']}))
    for plate, slot in [(2, 0), (7, 0), (9, 1)]:
        z.writestr(f'Metadata/plate_{plate}.json', json.dumps({'filament_ids': [slot]}))
        z.writestr(f'Metadata/plate_{plate}.png', image)
print(f'Wrote synthetic metadata-only fixture {target}')
