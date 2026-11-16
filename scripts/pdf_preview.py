"""Render a non-personal certificate fixture for visual QA."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from platform_app.pdf import certificate_pdf

target = Path(__file__).resolve().parent.parent / 'tmp/pdfs'
target.mkdir(parents=True, exist_ok=True)
result = certificate_pdf({'name': 'Елена Александровна Кузнецова', 'course': 'Python: от первой строки до проекта',
                          'issued_at': '2026-10-19 12:00:00', 'id': '96bea46f-1c9d-4ad6-b6cd-f79cd3c1b097'})
(target / 'certificate.pdf').write_bytes(result.getvalue())
print(target / 'certificate.pdf')
