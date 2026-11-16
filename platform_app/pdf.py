import io
import os
from pathlib import Path

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas


def certificate_pdf(certificate, verify_url=''):
    font_path = os.environ.get('PDF_FONT') or next((str(p) for p in [
        Path('C:/Windows/Fonts/arial.ttf'), Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
    ] if p.exists()), '')
    if not font_path:
        raise RuntimeError('Set PDF_FONT to a Unicode TrueType font')
    if 'Certificate' not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont('Certificate', font_path))

    ink = HexColor('#0e0e52')
    brand = HexColor('#150578')
    sky = HexColor('#78c0e0')
    gold = HexColor('#c99a39')
    muted = HexColor('#606887')
    paper = HexColor('#fbfaf6')
    width, height = 842, 595
    buffer = io.BytesIO()
    canvas = Canvas(buffer, pagesize=(width, height), pageCompression=1)
    canvas.setTitle('Сертификат о завершении курса — ' + certificate['course'])
    canvas.setAuthor('Образовательная платформа Вектор')

    canvas.setFillColor(paper)
    canvas.rect(0, 0, width, height, fill=1, stroke=0)
    canvas.setFillColor(HexColor('#f0f4fb'))
    canvas.circle(32, 558, 155, fill=1, stroke=0)
    canvas.circle(819, 26, 172, fill=1, stroke=0)

    # Широкая брендовая плашка создаёт сильную верхнюю часть сертификата.
    canvas.setFillColor(ink)
    canvas.roundRect(28, 475, 786, 84, 13, fill=1, stroke=0)
    canvas.setFillColor(sky)
    canvas.roundRect(28, 475, 786, 4, 2, fill=1, stroke=0)
    canvas.setFillColor(HexColor('#ffffff'))
    canvas.setFont('Certificate', 14)
    canvas.drawCentredString(width / 2, 525, 'В Е К Т О Р')
    canvas.setFillColor(HexColor('#c6d8f1'))
    canvas.setFont('Certificate', 9)
    canvas.drawCentredString(width / 2, 504, 'АКАДЕМИЯ · ОБРАЗОВАНИЕ В ДЕЙСТВИИ')

    # Двойная рамка и угловые метки держат печатный макет собранным.
    canvas.setStrokeColor(brand)
    canvas.setLineWidth(1.15)
    canvas.roundRect(22, 22, 798, 551, 16, fill=0, stroke=1)
    canvas.setStrokeColor(HexColor('#d9c18b'))
    canvas.setLineWidth(0.65)
    canvas.roundRect(34, 34, 774, 527, 12, fill=0, stroke=1)
    for x, direction in ((51, 1), (791, -1)):
        for y, dy in ((52, 1), (543, -1)):
            canvas.setStrokeColor(gold)
            canvas.setLineWidth(1.2)
            canvas.line(x, y, x + 21 * direction, y)
            canvas.line(x, y, x, y + 21 * dy)

    canvas.setFillColor(brand)
    canvas.setFont('Certificate', 30)
    canvas.drawCentredString(width / 2, 427, 'СЕРТИФИКАТ')
    canvas.setFillColor(muted)
    canvas.setFont('Certificate', 12)
    canvas.drawCentredString(width / 2, 405, 'ОБ УСПЕШНОМ ЗАВЕРШЕНИИ ОБУЧЕНИЯ')
    canvas.setStrokeColor(gold)
    canvas.setLineWidth(1)
    canvas.line(338, 387, 504, 387)
    canvas.setFillColor(gold)
    canvas.circle(width / 2, 387, 3, fill=1, stroke=0)

    canvas.setFillColor(muted)
    canvas.setFont('Certificate', 11)
    canvas.drawCentredString(width / 2, 360, 'НАГРАЖДАЕТСЯ')
    name_lines = simpleSplit(certificate['name'], 'Certificate', 25, 700)
    name_y = 326
    canvas.setFillColor(ink)
    canvas.setFont('Certificate', 25)
    for line in name_lines[:2]:
        canvas.drawCentredString(width / 2, name_y, line)
        name_y -= 31
    canvas.setStrokeColor(sky)
    canvas.setLineWidth(1.2)
    canvas.line(267, name_y + 14, 575, name_y + 14)

    course_y = name_y - 22
    canvas.setFillColor(muted)
    canvas.setFont('Certificate', 12)
    canvas.drawCentredString(width / 2, course_y, 'за успешное завершение курса')
    course_lines = simpleSplit(certificate['course'], 'Certificate', 19, 690)
    canvas.setFillColor(brand)
    canvas.setFont('Certificate', 19)
    for line in course_lines[:3]:
        course_y -= 29
        canvas.drawCentredString(width / 2, course_y, line)

    # Печать и данные об удостоверении создают ясный, но не перегруженный низ страницы.
    seal_x, seal_y = 132, 102
    canvas.setStrokeColor(gold)
    canvas.setLineWidth(1.4)
    canvas.circle(seal_x, seal_y, 34, fill=0, stroke=1)
    canvas.setStrokeColor(HexColor('#e5d4ad'))
    canvas.setLineWidth(0.7)
    canvas.circle(seal_x, seal_y, 28, fill=0, stroke=1)
    canvas.setFillColor(gold)
    star = canvas.beginPath()
    star.moveTo(seal_x, seal_y + 11)
    star.lineTo(seal_x + 4, seal_y + 3)
    star.lineTo(seal_x + 11, seal_y)
    star.lineTo(seal_x + 4, seal_y - 3)
    star.lineTo(seal_x, seal_y - 11)
    star.lineTo(seal_x - 4, seal_y - 3)
    star.lineTo(seal_x - 11, seal_y)
    star.lineTo(seal_x - 4, seal_y + 3)
    star.close()
    canvas.drawPath(star, fill=1, stroke=0)
    canvas.setFont('Certificate', 7)
    canvas.drawCentredString(seal_x, seal_y - 13, 'ВЕКТОР')

    canvas.setFillColor(muted)
    canvas.setFont('Certificate', 9)
    canvas.drawString(205, 126, 'ДАТА ВЫДАЧИ')
    canvas.setFillColor(ink)
    canvas.setFont('Certificate', 11)
    canvas.drawString(205, 108, certificate['issued_at'][:10])
    canvas.setFillColor(muted)
    canvas.setFont('Certificate', 9)
    canvas.drawString(205, 83, 'НОМЕР СЕРТИФИКАТА')
    canvas.setFillColor(ink)
    canvas.setFont('Certificate', 8)
    canvas.drawString(205, 66, certificate['id'])

    canvas.setStrokeColor(HexColor('#aab1ca'))
    canvas.line(582, 88, 752, 88)
    canvas.setFillColor(ink)
    canvas.setFont('Certificate', 10)
    canvas.drawCentredString(667, 70, 'Образовательная платформа')
    canvas.setFillColor(muted)
    canvas.setFont('Certificate', 8)
    canvas.drawCentredString(667, 56, 'Вектор · знания в действии')

    if verify_url:
        qr_size = 66
        qr_widget = QrCodeWidget(verify_url)
        qr_widget.barWidth = qr_size
        qr_widget.barHeight = qr_size
        qr_widget.barBorder = 2
        qr_widget.barFillColor = ink
        qr_drawing = Drawing(qr_size, qr_size)
        qr_drawing.add(qr_widget)
        renderPDF.draw(qr_drawing, canvas, 716, 112)
        canvas.setFillColor(muted)
        canvas.setFont('Certificate', 7)
        canvas.drawCentredString(749, 101, 'ПРОВЕРИТЬ ОНЛАЙН')

    canvas.showPage()
    canvas.save()
    buffer.seek(0)
    return buffer
