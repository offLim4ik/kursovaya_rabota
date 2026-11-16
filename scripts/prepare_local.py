"""Create a local secret once and first-party SVG cover illustrations."""
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

if not (ROOT / '.env').exists():
    (ROOT / '.env').write_text('SECRET_KEY=' + secrets.token_hex(32) + '\nDATABASE=instance/platform.sqlite3\nCOOKIE_SECURE=0\n', encoding='utf-8')

directory = ROOT / 'static/covers'
directory.mkdir(exist_ok=True)
themes = [('#dce6fc', '#3943b7', 'Py', 'PYTHON / CODE'), ('#f1e9f9', '#916ac0', 'Aa', 'DESIGN / PEOPLE'),
          ('#dcedf4', '#2580a7', 'SQL', 'DATA / INSIGHT'), ('#e4e9fb', '#5c67bf', '✓', 'QUALITY / CARE'),
          ('#f6eadf', '#a87845', '↗', 'PROJECT / TEAM'), ('#dcefe9', '#338d81', '{ }', 'SECURITY / TRUST')]
for i, (bg, accent, symbol, label) in enumerate(themes, 1):
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="720" height="400" viewBox="0 0 720 400">
<rect width="720" height="400" fill="{bg}"/><circle cx="560" cy="100" r="170" fill="none" stroke="{accent}" stroke-opacity=".15" stroke-width="2"/><circle cx="560" cy="100" r="130" fill="none" stroke="{accent}" stroke-opacity=".15" stroke-width="2"/>
<path d="M0 330 720 150M0 380 720 200" stroke="{accent}" stroke-opacity=".08" stroke-width="2"/>
<g transform="translate(265 80) rotate(-7 110 100)"><rect x="12" y="18" width="230" height="210" rx="25" fill="{accent}" opacity=".12"/><rect width="230" height="210" rx="25" fill="{accent}"/><text x="115" y="135" font-family="Arial,sans-serif" font-size="80" font-weight="bold" fill="white" text-anchor="middle">{symbol}</text><circle cx="27" cy="25" r="5" fill="white" opacity=".6"/><circle cx="45" cy="25" r="5" fill="white" opacity=".3"/></g>
<rect x="160" y="245" width="100" height="58" rx="12" fill="white"/><path d="m185 276 12 10 25-25" stroke="{accent}" stroke-width="5" fill="none"/><text x="42" y="365" font-family="Arial,sans-serif" letter-spacing="4" font-size="14" fill="{accent}">{label}</text><path d="M570 240v40m-20-20h40" stroke="{accent}" stroke-width="3"/></svg>'''
    (directory / f'{i}.svg').write_text(svg, encoding='utf-8')
print('Локальная конфигурация и обложки готовы. Секрет не выводится в терминал.')
