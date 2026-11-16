"""Validate Python sources and package reproducible application sources, never runtime data."""
import compileall
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parent.parent
for folder in ('platform_app', 'scripts', 'tests'):
    if not compileall.compile_dir(root / folder, quiet=1):
        raise SystemExit('Python compilation failed')
files = [root / x for x in ('app.py', 'requirements.txt', 'requirements-dev.txt', 'pyproject.toml', '.env.example', '.gitignore', 'README.md')]
for folder in ('platform_app', 'migrations', 'scripts', 'tests', 'docs'):
    files.extend(p for p in (root / folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix in ('.py', '.sql', '.md', '.json'))
files.extend([root / 'templates/shell.html', root / 'static/app.css', root / 'static/app.js', root / 'static/logo.svg'])
files.extend((root / 'static/covers').glob('*.svg'))
files = sorted(set(files))
output = root / 'dist'
output.mkdir(exist_ok=True)
manifest = {}
with ZipFile(output / 'vector-platform.zip', 'w', ZIP_DEFLATED) as archive:
    for file in files:
        relative = file.relative_to(root).as_posix()
        archive.write(file, relative)
        manifest[relative] = hashlib.sha256(file.read_bytes()).hexdigest()
(output / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
parts = ['# Полный исходный код платформы Вектор\n\nВсе пути относительно корня проекта. Секреты, база данных и пользовательские загрузки исключены.\n']
for file in files:
    parts.append('\n## ' + file.relative_to(root).as_posix() + '\n\n````' + file.suffix[1:] + '\n' + file.read_text(encoding='utf-8') + '\n````\n')
(output / 'SOURCE_CODE.md').write_text(''.join(parts), encoding='utf-8')
print(f'Production package: dist/vector-platform.zip ({len(files)} files). Full source: dist/SOURCE_CODE.md')
