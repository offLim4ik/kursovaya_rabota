import hashlib
import io
import json
import re
import secrets
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse

from flask import Blueprint, abort, current_app, g, jsonify, request, send_file, session
from PIL import Image, UnidentifiedImageError
from werkzeug.security import check_password_hash, generate_password_hash

from .db import db, one, rows
from .services import (
    audit,
    complete,
    course,
    curriculum,
    data,
    enrollment,
    event,
    integer,
    lesson_access,
    public_user,
    quiz_data,
    require,
    summary,
    text,
)

api = Blueprint('api', __name__)


@api.get('/session')
def get_session():
    return jsonify(user=public_user(g.user) if g.user else None, csrf=session['csrf'])


def throttle():
    keys = [request.remote_addr or 'local']
    for key in keys:
        key = hashlib.sha256(key.encode()).hexdigest()
        now = int(time.time())
        db().execute('DELETE FROM login_limits WHERE since<?', (now - 900,))
        limit = one('SELECT * FROM login_limits WHERE key=?', (key,))
        if limit and limit['count'] >= 15:
            abort(429, 'Слишком много попыток. Повторите через 15 минут.')
        db().execute('INSERT INTO login_limits(key,count,since) VALUES (?,1,?) '
                     'ON CONFLICT(key) DO UPDATE SET count=count+1', (key, now))
    db().commit()
    db().execute('BEGIN IMMEDIATE')


@api.post('/register')
def register():
    throttle()
    d = data()
    email = text(d.get('email'), 5, 254).lower()
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
        abort(400, 'Введите корректный email.')
    name = text(d.get('name'), 2, 80)
    password = text(d.get('password'), 10, 128)
    uid = db().execute('INSERT INTO users(email,name,password) VALUES (?,?,?)',
                       (email, name, generate_password_hash(password))).lastrowid
    db().commit()
    session.clear()
    session.permanent = True
    session.update(uid=uid, version=0, csrf=secrets.token_urlsafe(32))
    return jsonify(user=public_user(one('SELECT * FROM users WHERE id=?', (uid,))), csrf=session['csrf']), 201


@api.post('/login')
def login():
    throttle()
    d = data()
    email = text(d.get('email'), 1, 254).lower()
    password = text(d.get('password'), 1, 128)
    user = one('SELECT * FROM users WHERE email=?', (email,))
    # Hash work is also performed for unknown addresses.
    encoded = user['password'] if user else generate_password_hash('unavailable-account')
    valid = check_password_hash(encoded, password)
    if not user or not valid or user['blocked']:
        abort(401, 'Неверные данные или аккаунт заблокирован.')
    session.clear()
    session.permanent = True
    session.update(uid=user['id'], version=user['session_version'], csrf=secrets.token_urlsafe(32))
    db().commit()
    return jsonify(user=public_user(user), csrf=session['csrf'])


@api.post('/logout')
def logout():
    session.clear()
    return jsonify(ok=True)


@api.put('/profile')
@require()
def profile():
    d = data()
    name = text(d.get('name'), 2, 80)
    avatar = text(d.get('avatar', ''), maximum=100)
    if avatar and not one("SELECT id FROM materials WHERE '/api/media/'||id=? AND owner_id=? AND public=1 AND kind='image'", (avatar, g.user['id'])):
        abort(400, 'Сначала загрузите аватар.')
    db().execute('UPDATE users SET name=?,avatar=? WHERE id=?', (name, avatar, g.user['id']))
    db().commit()
    return jsonify(ok=True)


@api.post('/password')
@require()
def password():
    d = data()
    if not check_password_hash(g.user['password'], text(d.get('current'), 1, 128)):
        abort(400, 'Текущий пароль неверен.')
    new = text(d.get('password'), 10, 128)
    db().execute('UPDATE users SET password=?,session_version=session_version+1 WHERE id=?',
                 (generate_password_hash(new), g.user['id']))
    session['version'] = g.user['session_version'] + 1
    db().commit()
    return jsonify(ok=True)


@api.get('/categories')
def categories():
    return jsonify(rows('SELECT * FROM categories ORDER BY name'))


@api.get('/courses')
def courses():
    uid = g.user['id'] if g.user else None
    result = [summary(c, uid) for c in rows('SELECT c.*,cat.name category FROM courses c LEFT JOIN categories cat '
                                          "ON cat.id=c.category_id WHERE c.status='published' ORDER BY c.id DESC")]
    query = request.args.get('q', '').casefold()
    result = [c for c in result if query in (c['title'] + ' ' + c['description']).casefold()]
    for key in ('category_id', 'level'):
        if request.args.get(key):
            result = [c for c in result if str(c[key]) == request.args[key]]
    status = request.args.get('status')
    if status == 'enrolled':
        result = [c for c in result if c['enrollment']]
    elif status == 'new':
        result = [c for c in result if not c['enrollment']]
    elif status == 'favorite':
        result = [c for c in result if c['favorite']]
    if request.args.get('sort') == 'popular':
        result.sort(key=lambda c: c['enrolled_count'], reverse=True)
    page = integer(request.args.get('page', 1))
    return jsonify(items=result[(page-1)*6:page*6], total=len(result), page=page, pages=max(1, (len(result)+5)//6))


@api.get('/courses/<int:cid>')
def detail(cid):
    c = summary(course(cid), g.user['id'] if g.user else None)
    c['lessons'] = curriculum(cid, c['enrollment'])
    c['reviews'] = rows('SELECT r.*,u.name FROM reviews r JOIN users u ON u.id=r.user_id WHERE course_id=? ORDER BY created_at DESC', (cid,))
    return jsonify(c)


@api.post('/courses/<int:cid>/enroll')
@require()
def enroll(cid):
    c = course(cid)
    if c['status'] != 'published' and not enrollment(cid):
        abort(400, 'Запись на этот курс закрыта.')
    changed = db().execute('INSERT OR IGNORE INTO enrollments(user_id,course_id) VALUES (?,?)', (g.user['id'], cid)).rowcount
    if changed:
        event(g.user['id'], cid, 'Вы записались на курс «' + c['title'] + '»', True)
    db().commit()
    return jsonify(summary(c, g.user['id']))


@api.post('/courses/<int:cid>/favorite')
@require()
def favorite(cid):
    course(cid)
    enabled = data().get('enabled')
    if not isinstance(enabled, bool):
        abort(400, 'Некорректный статус избранного.')
    if enabled:
        db().execute('INSERT OR IGNORE INTO favorites VALUES (?,?)', (g.user['id'], cid))
    else:
        db().execute('DELETE FROM favorites WHERE user_id=? AND course_id=?', (g.user['id'], cid))
    db().commit()
    return jsonify(ok=True)


@api.get('/dashboard')
@require()
def dashboard():
    uid = g.user['id']
    enrolled = rows('SELECT c.* FROM courses c JOIN enrollments e ON e.course_id=c.id WHERE e.user_id=? ORDER BY e.last_activity DESC', (uid,))
    cs = [summary(c, uid) for c in enrolled]
    return jsonify(courses=cs, events=rows('SELECT * FROM events WHERE user_id=? ORDER BY id DESC LIMIT 100', (uid,)),
                   notifications=rows('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100', (uid,)),
                   certificates=rows('SELECT c.* FROM certificates c JOIN enrollments e ON e.id=c.enrollment_id WHERE e.user_id=?', (uid,)),
                   stats={'courses': sum(bool(c['enrollment']['completed_at']) for c in cs), 'lessons': sum(c['done'] for c in cs),
                          'score': one('SELECT round(avg(score)) n FROM attempts WHERE user_id=?', (uid,))['n'] or 0},
                   goal=one('SELECT * FROM learning_goals WHERE user_id=?', (uid,)) or {'weekly_minutes':120,'reminder_time':'18:00','reminder_enabled':1},
                   study_minutes=one("SELECT COALESCE(sum(l.minutes),0) n FROM progress p JOIN lessons l ON l.id=p.lesson_id JOIN enrollments e ON e.id=p.enrollment_id WHERE e.user_id=? AND p.started_at>=datetime('now','-7 days')", (uid,))['n'])


@api.put('/learning-goal')
@require()
def learning_goal():
    d = data()
    weekly_minutes = integer(d.get('weekly_minutes'), 15, 2400)
    reminder_time = text(d.get('reminder_time'), 5, 5)
    if not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', reminder_time):
        abort(400, 'Укажите время в формате ЧЧ:ММ.')
    enabled = d.get('reminder_enabled')
    if not isinstance(enabled, bool):
        abort(400, 'Некорректное состояние напоминаний.')
    db().execute('INSERT INTO learning_goals(user_id,weekly_minutes,reminder_time,reminder_enabled) VALUES (?,?,?,?) '
                 'ON CONFLICT(user_id) DO UPDATE SET weekly_minutes=excluded.weekly_minutes,reminder_time=excluded.reminder_time,reminder_enabled=excluded.reminder_enabled',
                 (g.user['id'], weekly_minutes, reminder_time, enabled))
    db().commit()
    return jsonify(ok=True)


@api.post('/notifications/read')
@require()
def read_notifications():
    db().execute('UPDATE notifications SET seen=1 WHERE user_id=?', (g.user['id'],))
    db().commit()
    return jsonify(ok=True)


@api.get('/lessons/<int:lid>')
@require()
def get_lesson(lid):
    l, e = lesson_access(lid)
    l['course'] = summary(course(l['course_id']), g.user['id'])
    l['plan'] = curriculum(l['course_id'], e)
    l['quiz'] = quiz_data(lid)
    l['materials'] = rows('SELECT id,name,kind FROM materials WHERE lesson_id=?', (lid,))
    l['note'] = one('SELECT text FROM notes WHERE user_id=? AND lesson_id=?', (g.user['id'], lid)) or {'text': ''}
    l['attempts'] = rows('SELECT a.id,a.score,a.passed,a.created_at,a.feedback FROM attempts a JOIN quizzes q ON q.id=a.quiz_id WHERE q.lesson_id=? AND a.user_id=? ORDER BY a.id DESC', (lid, g.user['id']))
    for attempt in l['attempts']:
        attempt['feedback'] = json.loads(attempt['feedback'])
    assignment = one('SELECT * FROM assignments WHERE lesson_id=?', (lid,))
    if assignment:
        assignment['rubric'] = json.loads(assignment['rubric'])
        assignment['submission'] = one('SELECT s.*,m.name file_name FROM assignment_submissions s LEFT JOIN materials m ON m.id=s.attachment_id WHERE s.assignment_id=? AND s.user_id=?', (assignment['id'], g.user['id']))
        if assignment['submission']:
            assignment['submission']['rubric_scores'] = json.loads(assignment['submission']['rubric_scores'])
    l['assignment'] = assignment
    return jsonify(l)


@api.post('/lessons/<int:lid>/assignment')
@require()
def submit_assignment(lid):
    lesson, e = lesson_access(lid)
    assignment = one('SELECT * FROM assignments WHERE lesson_id=?', (lid,))
    if not assignment:
        abort(404, 'Практическое задание не найдено.')
    d = data()
    body = text(d.get('body', ''), maximum=20000)
    attachment_id = d.get('attachment_id')
    if assignment['submission_type'] == 'text' and len(body.strip()) < 10:
        abort(400, 'Добавьте ответ объёмом не менее 10 символов.')
    if assignment['submission_type'] == 'url':
        parsed = urlparse(body)
        if parsed.scheme != 'https' or not parsed.netloc or len(body) > 2000:
            abort(400, 'Укажите корректную ссылку с https://.')
    if assignment['submission_type'] == 'file':
        attachment_id = integer(attachment_id)
        if not one("SELECT id FROM materials WHERE id=? AND private_owner=? AND lesson_id=? AND kind='file'", (attachment_id, g.user['id'], lid)):
            abort(400, 'Сначала загрузите свой файл к заданию.')
    existing = one('SELECT * FROM assignment_submissions WHERE assignment_id=? AND user_id=?', (assignment['id'], g.user['id']))
    if existing and existing['status'] == 'approved':
        abort(409, 'Принятую работу нельзя заменить.')
    db().execute('INSERT INTO assignment_submissions(assignment_id,user_id,body,attachment_id,status) VALUES (?,?,?,? ,\'submitted\') '
        'ON CONFLICT(assignment_id,user_id) DO UPDATE SET body=excluded.body,attachment_id=excluded.attachment_id,status=\'submitted\',score=NULL,feedback=\'\',rubric_scores=\'{}\',submitted_at=CURRENT_TIMESTAMP,reviewed_at=NULL',
        (assignment['id'], g.user['id'], body, attachment_id))
    db().execute('UPDATE enrollments SET last_activity=CURRENT_TIMESTAMP,last_lesson=? WHERE id=?', (lid, e['id']))
    event(g.user['id'], lesson['course_id'], 'Сдана практическая работа «' + assignment['title'] + '»')
    db().commit()
    return jsonify(ok=True)


@api.post('/lessons/<int:lid>/open')
@require()
def open_lesson(lid):
    l, e = lesson_access(lid)
    changed = db().execute('INSERT OR IGNORE INTO progress(enrollment_id,lesson_id) VALUES (?,?)', (e['id'], lid)).rowcount
    db().execute('UPDATE enrollments SET last_lesson=?,last_activity=CURRENT_TIMESTAMP WHERE id=?', (lid, e['id']))
    if changed:
        event(g.user['id'], l['course_id'], 'Начат урок «' + l['title'] + '»')
    db().commit()
    return jsonify(ok=True)


@api.post('/lessons/<int:lid>/complete')
@require()
def finish_lesson(lid):
    l, e = lesson_access(lid)
    if one('SELECT id FROM quizzes WHERE lesson_id=?', (lid,)):
        abort(400, 'Для завершения урока пройдите тест.')
    assignment = one("SELECT a.id FROM assignments a LEFT JOIN assignment_submissions s ON s.assignment_id=a.id AND s.user_id=? WHERE a.lesson_id=? AND a.required=1 AND (s.status IS NULL OR s.status!='approved')", (g.user['id'], lid))
    if assignment:
        abort(400, 'Сначала сдайте практическую работу и дождитесь её принятия.')
    complete(l, e)
    db().commit()
    return jsonify(ok=True)


@api.put('/lessons/<int:lid>/note')
@require()
def note(lid):
    lesson_access(lid)
    value = text(data().get('text'), maximum=10000)
    db().execute('INSERT INTO notes(user_id,lesson_id,text) VALUES (?,?,?) ON CONFLICT(user_id,lesson_id) '
                 'DO UPDATE SET text=excluded.text,updated_at=CURRENT_TIMESTAMP', (g.user['id'], lid, value))
    db().commit()
    return jsonify(ok=True)


@api.post('/lessons/<int:lid>/attempt')
@require()
def attempt(lid):
    l, e = lesson_access(lid)
    q = quiz_data(lid, True)
    if not q:
        abort(404, 'Тест не найден.')
    answers = data().get('answers')
    if not isinstance(answers, dict):
        abort(400, 'Ответьте на вопросы теста.')
    feedback = []
    for question in q['questions']:
        answer = answers.get(str(question['id']), [])
        if not isinstance(answer, list) or not answer or any(type(x) is not int or x < 0 or x >= len(question['options']) for x in answer):
            abort(400, 'Выберите ответ на каждый вопрос.')
        correct = set(answer) == set(question['correct'])
        feedback.append({'text': question['text'], 'correct': correct, 'explanation': question['explanation'],
                         'answer': [question['options'][x] for x in question['correct']]})
    score = round(sum(f['correct'] for f in feedback) / len(feedback) * 100)
    passed = score >= q['pass_score']
    db().execute('INSERT INTO attempts(user_id,quiz_id,score,passed,answers,feedback) VALUES (?,?,?,?,?,?)',
                 (g.user['id'], q['id'], score, passed, json.dumps(answers), json.dumps(feedback, ensure_ascii=False)))
    db().execute('UPDATE enrollments SET last_activity=CURRENT_TIMESTAMP WHERE id=?', (e['id'],))
    event(g.user['id'], l['course_id'], f'Тест «{l["title"]}»: {score}%')
    assignment = one("SELECT a.id FROM assignments a LEFT JOIN assignment_submissions s ON s.assignment_id=a.id AND s.user_id=? WHERE a.lesson_id=? AND a.required=1 AND (s.status IS NULL OR s.status!='approved')", (g.user['id'], lid))
    if passed and not assignment:
        complete(l, e)
    db().commit()
    return jsonify(score=score, passed=passed, feedback=feedback)


@api.post('/courses/<int:cid>/review')
@require()
def review(cid):
    e = enrollment(cid)
    if not e or not e['completed_at']:
        abort(403, 'Отзыв доступен после завершения курса.')
    d = data()
    db().execute('INSERT INTO reviews(user_id,course_id,rating,text) VALUES (?,?,?,?) ON CONFLICT(user_id,course_id) '
                 'DO UPDATE SET rating=excluded.rating,text=excluded.text',
                 (g.user['id'], cid, integer(d.get('rating'), 1, 5), text(d.get('text'), 5, 2000)))
    db().commit()
    return jsonify(ok=True)


@api.post('/upload')
@require()
def upload():
    file = request.files.get('file')
    if not file or not file.filename:
        abort(400, 'Выберите файл.')
    purpose = request.form.get('purpose', 'avatar')
    if purpose not in ('avatar', 'cover', 'material', 'assignment') or (purpose != 'avatar' and purpose != 'assignment' and g.user['role'] != 'admin'):
        abort(403, 'Недостаточно прав.')
    lid = request.form.get('lesson_id')
    if purpose in ('material', 'assignment'):
        lid = integer(lid)
        if not one('SELECT id FROM lessons WHERE id=?', (lid,)):
            abort(404, 'Урок не найден.')
        if purpose == 'assignment':
            lesson_access(lid)
            if not one("SELECT id FROM assignments WHERE lesson_id=? AND submission_type='file'", (lid,)):
                abort(400, 'Для этого задания не предусмотрена загрузка файла.')
    else:
        lid = None
    raw = file.read(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024:
        abort(400, 'Максимальный размер файла — 8 МБ.')
    suffix = Path(file.filename).suffix.lower()
    kind = 'file'
    if purpose == 'assignment' and suffix not in ('.pdf', '.txt', '.csv'):
        abort(400, 'Практическую работу можно сдать в формате PDF, TXT или CSV.')
    if suffix in ('.png', '.jpg', '.jpeg', '.webp'):
        try:
            img = Image.open(io.BytesIO(raw))
            if img.width * img.height > 16000000:
                abort(400, 'Изображение слишком большое: максимум 16 мегапикселей.')
            img.load()
            img.thumbnail((1600, 1600))
            output = io.BytesIO()
            img.convert('RGB').save(output, 'JPEG', quality=88)
            raw = output.getvalue()
            suffix = '.jpg'
            kind = 'image'
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
            abort(400, 'Не удалось прочитать изображение.')
    elif purpose not in ('material', 'assignment') or suffix not in ('.pdf', '.txt', '.csv'):
        abort(400, 'Разрешены JPG, PNG, WebP; для уроков также PDF, TXT и CSV.')
    elif suffix == '.pdf' and not raw.startswith(b'%PDF-'):
        abort(400, 'Некорректный PDF.')
    elif suffix in ('.txt', '.csv'):
        try:
            raw.decode('utf-8')
        except UnicodeDecodeError:
            abort(400, 'Текстовый файл должен использовать UTF-8.')
    if purpose not in ('avatar', 'assignment'):
        audit('Загружен материал' if purpose == 'material' else 'Загружена обложка', Path(file.filename).name[:120])
    filename = uuid.uuid4().hex + suffix
    path = Path(current_app.config['UPLOAD_FOLDER']) / filename
    path.write_bytes(raw)
    private_owner = g.user['id'] if purpose == 'assignment' else None
    mid = db().execute('INSERT INTO materials(owner_id,lesson_id,name,path,kind,public,private_owner) VALUES (?,?,?,?,?,?,?)',
                       (g.user['id'], lid, Path(file.filename).name[:120], filename, kind, purpose not in ('material', 'assignment'), private_owner)).lastrowid
    db().commit()
    return jsonify(url=f'/api/media/{mid}', id=mid)


@api.get('/media/<int:mid>')
def media(mid):
    m = one('SELECT * FROM materials WHERE id=?', (mid,))
    if not m:
        abort(404, 'Файл не найден.')
    if not m['public']:
        if not g.user:
            abort(401, 'Войдите в аккаунт.')
        if m['private_owner'] is not None and g.user['role'] != 'admin' and m['private_owner'] != g.user['id']:
            abort(404, 'Файл не найден.')
        if m['private_owner'] is None and g.user['role'] != 'admin':
            lesson_access(m['lesson_id'])
    return send_file(Path(current_app.config['UPLOAD_FOLDER']) / m['path'], as_attachment=m['kind'] == 'file', download_name=m['name'])


@api.get('/certificates/<cid>/pdf')
@require()
def certificate(cid):
    c = one('SELECT c.* FROM certificates c JOIN enrollments e ON e.id=c.enrollment_id WHERE c.id=? AND e.user_id=?', (cid, g.user['id']))
    if not c:
        abort(404, 'Сертификат не найден.')
    from .pdf import certificate_pdf
    return send_file(certificate_pdf(c), mimetype='application/pdf', as_attachment=True, download_name=f'certificate-{cid}.pdf')
