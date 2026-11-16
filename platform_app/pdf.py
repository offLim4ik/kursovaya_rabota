import io
import os
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas


def certificate_pdf(certificate):
    font_path = os.environ.get('PDF_FONT') or next((str(p) for p in [
        Path('C:/Windows/Fonts/arial.ttf'), Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
    ] if p.exists()), '')
    if not font_path:
        raise RuntimeError('Set PDF_FONT to a Unicode TrueType font')
    if 'Certificate' not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont('Certificate', font_path))
    buffer = io.BytesIO()
    canvas = Canvas(buffer, pagesize=(842, 595))
    canvas.setTitle('Сертификат о завершении курса')
    canvas.setFillColor(HexColor('#f4f7fc'))
    canvas.rect(0, 0, 842, 595, fill=1, stroke=0)
    canvas.setStrokeColor(HexColor('#3943b7'))
    canvas.setLineWidth(2)
    canvas.rect(28, 28, 786, 539)
    canvas.setFillColor(HexColor('#150578'))
    canvas.setFont('Certificate', 17)
    canvas.drawString(65, 520, 'ВЕКТОР / образовательная платформа')
    canvas.setFont('Certificate', 36)
    canvas.drawCentredString(421, 435, 'СЕРТИФИКАТ')
    canvas.setFont('Certificate', 14)
    canvas.drawCentredString(421, 403, 'о завершении образовательного курса')
    y = 340
    for value, size, gap in [(certificate['name'], 25, 35), ('успешно завершил(а) курс', 14, 30), (certificate['course'], 23, 32)]:
        canvas.setFont('Certificate', size)
        for line in simpleSplit(value, 'Certificate', size, 680):
            canvas.drawCentredString(421, y, line)
            y -= gap
        y -= 10
    canvas.setFont('Certificate', 12)
    canvas.drawString(65, 103, 'Дата завершения: ' + certificate['issued_at'][:10])
    canvas.setFont('Certificate', 10)
    canvas.drawString(65, 77, 'Уникальный номер: ' + certificate['id'])
    canvas.save()
    buffer.seek(0)
    return buffer
