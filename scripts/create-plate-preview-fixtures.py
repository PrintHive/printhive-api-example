"""Create synthetic ZIP fixtures for saved plate preview inspection."""
from pathlib import Path
import json
import struct
import zlib
import zipfile

OUT = Path('test/fixtures/plate-previews')
OUT.mkdir(parents=True, exist_ok=True)

def png(color, width=240, height=160):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    rows = []
    for y in range(height):
        row = bytearray()
        for x in range(width):
            c = color if 75 <= x < 165 and 40 <= y < 120 else (235, 238, 230)
            row.extend((*c, 255))
        rows.append(b'\0' + row)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b''.join(rows))) + chunk(b'IEND', b'')

settings = json.dumps({'filament_type': ['PETG', 'PETG'], 'filament_colour': ['#B44235', '#296AAB']})
plate_xml = '<config>' + ''.join(f'<plate><metadata key="plater_id" value="{n}"/><metadata key="plater_name" value="{label}"/><metadata key="thumbnail_file" value="Metadata/plate_{n}.png"/></plate>' for n, label in [(2, 'Red square'), (7, 'Blue square')]) + '</config>'
for name in ['valid', 'invalid', 'missing', 'oversized', 'unsafe-reference', 'oversized-dimensions', 'cross-plate']:
    xml = plate_xml if name != 'unsafe-reference' else plate_xml.replace('Metadata/plate_2.png', '../outside.png')
    if name == 'cross-plate': xml = xml.replace('Metadata/plate_2.png', 'Metadata/plate_7.png')
    with zipfile.ZipFile(OUT / f'{name}.3mf', 'w', compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr('Metadata/project_settings.config', settings)
        z.writestr('Metadata/model_settings.config', xml)
        z.writestr('Metadata/plate_2.json', json.dumps({'filament_ids': [0]}))
        z.writestr('Metadata/plate_7.json', json.dumps({'filament_ids': [1]}))
        if name != 'missing':
            image = png((180, 66, 53))
            if name == 'invalid': image = b'\x89PNG\r\n\x1a\n'
            if name == 'oversized': image = b'x' * (512 * 1024 + 1)
            if name == 'oversized-dimensions': image = image[:16] + struct.pack('>II', 100000, 100000) + image[24:]
            z.writestr('Metadata/plate_2.png', image)
        z.writestr('Metadata/plate_7.png', png((41, 106, 171)))
print(f'Wrote synthetic metadata-only fixtures under {OUT}')
