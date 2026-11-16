import json

from flask import Blueprint, abort, jsonify, request

from .db import db, one, rows
from .services import (
    audit,
    clean,
    data,
    integer,
    public_user,
    quiz_data,
    require,
    summary,
    text,
    video_url,
)

admin = Blueprint('admin', __name__)


@admin.before_request
@require(admin=True)
def guard():
    return None


@admin.get('/overview')
def overview():
    days = integer(request.args.get('days', 30), 7, 365)
    since = f'-{days - 1} days'
    return jsonify(
        stats={'users': one('SELECT count(*) n FROM users')['n'],
               'courses': one("SELECT count(*) n FROM courses WHERE status='published'")['n'],
               'enrollments': one('SELECT count(*) n FROM enrollments')['n'],
               'completed': one('SELECT count(*) n FROM enrollments WHERE completed_at IS NOT NULL')['n']},
        registrations=rows('SELECT date(created_at) day,count(*) count FROM users WHERE date(created_at)>=date(\'now\',?) GROUP BY day', (since,)),
        enrollments=rows('SELECT date(created_at) day,count(*) count FROM enrollments WHERE date(created_at)>=date(\'now\',?) GROUP BY day', (since,)),
        popular=rows('SELECT c.id,c.title,count(e.id) count,sum(e.completed_at IS NOT NULL) completed FROM courses c LEFT JOIN enrollments e ON c.id=e.course_id GROUP BY c.id ORDER BY count DESC LIMIT 8'),
        events=rows('SELECT e.*,u.name FROM events e JOIN users u ON u.id=e.user_id ORDER BY e.id DESC LIMIT 25'))


@admin.get('/audit')
def audit_list():
    return jsonify(rows('SELECT a.*,u.name FROM audit a JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 300'))


@admin.get('/users')
def users():
    query = '%' + request.args.get('q', '').casefold() + '%'
    result = rows('SELECT * FROM users WHERE casefold(name) LIKE ? OR casefold(email) LIKE ? ORDER BY id DESC', (query, query))
    status = request.args.get('status')
    if status in ('active', 'blocked'):
        result = [u for u in result if bool(u['blocked']) == (status == 'blocked')]
    return jsonify([public_user(u) for u in result])


@admin.get('/users/<int:uid>')
def user_detail(uid):
    u = one('SELECT * FROM users WHERE id=?', (uid,))
    if not u:
        abort(404, 'Пользователь не найден.')
    courses = rows('SELECT c.* FROM courses c JOIN enrollments e ON e.course_id=c.id WHERE e.user_id=?', (uid,))
    return jsonify(user=public_user(u), courses=[summary(c, uid) for c in courses])


@admin.post('/users/<int:uid>/block')
def block(uid):
    u = one('SELECT * FROM users WHERE id=?', (uid,))
    if not u:
        abort(404, 'Пользователь не найден.')
    blocked = data().get('blocked')
    if not isinstance(blocked, bool):
        abort(400, 'Некорректный статус.')
    if blocked and u['role'] == 'admin' and not u['blocked'] and one("SELECT count(*) n FROM users WHERE role='admin' AND blocked=0")['n'] <= 1:
        abort(400, 'Нельзя заблокировать последнего активного администратора.')
    db().execute('UPDATE users SET blocked=?,session_version=session_version+1 WHERE id=?', (blocked, uid))
    audit('Блокировка' if blocked else 'Разблокировка', f'Пользователь {uid}: {u["email"]}')
    db().commit()
    return jsonify(ok=True)


@admin.post('/categories')
def create_category():
    name = text(data().get('name'), 2, 80)
    cid = db().execute('INSERT INTO categories(name) VALUES (?)', (name,)).lastrowid
    audit('Создана категория', name)
    db().commit()
    return jsonify(id=cid)


@admin.get('/courses')
def course_list():
    return jsonify([summary(c) for c in rows('SELECT c.*,cat.name category FROM courses c LEFT JOIN categories cat ON cat.id=c.category_id ORDER BY c.id DESC')])


@admin.post('/courses')
def create_course():
    title = text(data().get('title', 'Новый курс'), 3, 150)
    cid = db().execute('INSERT INTO courses(title) VALUES (?)', (title,)).lastrowid
    audit('Создан курс', f'{cid}: {title}')
    db().commit()
    return jsonify(id=cid), 201


def editor_data(cid):
    c = one('SELECT * FROM courses WHERE id=?', (cid,))
    if not c:
        abort(404, 'Курс не найден.')
    c['modules'] = rows('SELECT * FROM modules WHERE course_id=? ORDER BY position,id', (cid,))
    for m in c['modules']:
        m['lessons'] = rows('SELECT * FROM lessons WHERE module_id=? ORDER BY position,id', (m['id'],))
        for l in m['lessons']:
            l['quiz'] = quiz_data(l['id'], True)
            l['materials'] = rows('SELECT id,name,kind FROM materials WHERE lesson_id=?', (l['id'],))
    c['locked_structure'] = bool(one('SELECT id FROM enrollments WHERE course_id=? LIMIT 1', (cid,)))
    return c


@admin.get('/courses/<int:cid>')
def get_course(cid):
    return jsonify(editor_data(cid))


def validate_quiz(q):
    if q is None:
        return None
    if not isinstance(q, dict) or not isinstance(q.get('questions'), list) or not 1 <= len(q['questions']) <= 50:
        abort(400, 'В тесте должно быть от 1 до 50 вопросов.')
    result = {'pass_score': integer(q.get('pass_score'), 1, 100), 'questions': []}
    for question in q['questions']:
        if not isinstance(question, dict):
            abort(400, 'Некорректный вопрос.')
        opts = question.get('options')
        correct = question.get('correct')
        if not isinstance(opts, list) or not 2 <= len(opts) <= 10:
            abort(400, 'Добавьте от 2 до 10 вариантов ответа.')
        opts = [text(o, 1, 500) for o in opts]
        if len(set(opts)) != len(opts):
            abort(400, 'Варианты ответа не должны повторяться.')
        if not isinstance(correct, list) or not correct or any(type(x) is not int or x < 0 or x >= len(opts) for x in correct):
            abort(400, 'Отметьте хотя бы один корректный ответ.')
        result['questions'].append({'text': text(question.get('text'), 3, 1000), 'options': opts,
                                     'correct': sorted(set(correct)), 'explanation': text(question.get('explanation', ''), maximum=2000)})
    return result


@admin.put('/courses/<int:cid>')
def save_course(cid):
    original = editor_data(cid)
    d = data()
    title = text(d.get('title'), 3, 150)
    description = text(d.get('description', ''), maximum=20000)
    short = text(d.get('summary', ''), maximum=250)
    outcomes = text(d.get('outcomes', ''), maximum=5000)
    prerequisites = text(d.get('prerequisites', ''), maximum=3000)
    category = d.get('category_id') or None
    if category and not one('SELECT id FROM categories WHERE id=?', (integer(category),)):
        abort(400, 'Категория не найдена.')
    level = d.get('level', 'Начальный')
    status = d.get('status', 'draft')
    progression = d.get('progression', 'sequential')
    if level not in ('Начальный', 'Средний', 'Продвинутый') or status not in ('draft', 'published', 'archived'):
        abort(400, 'Некорректный уровень или статус.')
    if progression not in ('sequential', 'free'):
        abort(400, 'Выберите допустимый порядок прохождения.')
    if original['locked_structure'] and status == 'draft':
        abort(400, 'Курс с участниками можно только опубликовать или архивировать.')
    cover = text(d.get('cover', ''), maximum=150)
    if cover and not (reliable_cover(cover)):
        abort(400, 'Обложку необходимо загрузить через форму.')
    modules = d.get('modules', [])
    if not isinstance(modules, list) or len(modules) > 30:
        abort(400, 'Допускается до 30 модулей.')
    old_modules = {m['id'] for m in original['modules']}
    old_lessons = {l['id'] for m in original['modules'] for l in m['lessons']}
    seen_modules, seen_lessons = set(), set()
    prepared = []
    for m in modules:
        if not isinstance(m, dict):
            abort(400, 'Некорректный модуль.')
        mid = m.get('id')
        if mid and (mid not in old_modules or mid in seen_modules):
            abort(400, 'Некорректный идентификатор модуля.')
        if mid:
            seen_modules.add(mid)
        pm = {'id': mid, 'title': text(m.get('title'), 2, 150), 'lessons': []}
        if not isinstance(m.get('lessons'), list) or len(m['lessons']) > 100:
            abort(400, 'Допускается до 100 уроков в модуле.')
        for l in m['lessons']:
            if not isinstance(l, dict):
                abort(400, 'Некорректный урок.')
            lid = l.get('id')
            if lid and (lid not in old_lessons or lid in seen_lessons):
                abort(400, 'Некорректный идентификатор урока.')
            if lid:
                seen_lessons.add(lid)
            pm['lessons'].append({'id': lid, 'title': text(l.get('title'), 2, 150),
                                  'content': clean(l.get('content', '')), 'video': video_url(l.get('video', '')),
                                  'minutes': integer(l.get('minutes', 15), 1, 600), 'quiz': validate_quiz(l.get('quiz'))})
        prepared.append(pm)
    if original['locked_structure']:
        if seen_lessons != old_lessons or any(not l['id'] for m in prepared for l in m['lessons']):
            abort(400, 'На курс уже записались. Добавление и удаление уроков запрещено; создайте новый курс.')
        for m in prepared:
            for l in m['lessons']:
                old_q = quiz_data(l['id'], True)
                if old_q:
                    old_q = {'pass_score': old_q['pass_score'], 'questions': [{k: q[k] for k in ('text', 'options', 'correct', 'explanation')} for q in old_q['questions']]}
                if old_q != l['quiz']:
                    abort(400, 'Тест курса с участниками зафиксирован для сохранения истории попыток.')
    if status == 'published':
        if not category or not description or not short or not outcomes or not prepared or not any(m['lessons'] for m in prepared):
            abort(400, 'Перед публикацией заполните описание, результаты, категорию и программу.')
        for m in prepared:
            if not m['lessons'] or any(not l['content'] and not l['video'] and not l['quiz'] for l in m['lessons']):
                abort(400, 'В каждом модуле нужны уроки, а в каждом уроке — материал или тест.')
    db().execute('UPDATE courses SET title=?,description=?,summary=?,outcomes=?,prerequisites=?,category_id=?,level=?,status=?,cover=?,progression=? WHERE id=?',
                 (title, description, short, outcomes, prerequisites, category, level, status, cover, progression, cid))
    for pos, m in enumerate(prepared):
        if m['id']:
            db().execute('UPDATE modules SET title=?,position=? WHERE id=?', (m['title'], pos, m['id']))
        else:
            m['id'] = db().execute('INSERT INTO modules(course_id,title,position) VALUES (?,?,?)', (cid, m['title'], pos)).lastrowid
        for lp, l in enumerate(m['lessons']):
            values = (m['id'], l['title'], l['content'], l['video'], l['minutes'], lp)
            if l['id']:
                db().execute('UPDATE lessons SET module_id=?,title=?,content=?,video=?,minutes=?,position=? WHERE id=?', (*values, l['id']))
            else:
                l['id'] = db().execute('INSERT INTO lessons(module_id,title,content,video,minutes,position) VALUES (?,?,?,?,?,?)', values).lastrowid
            if not original['locked_structure']:
                db().execute('DELETE FROM quizzes WHERE lesson_id=?', (l['id'],))
                if l['quiz']:
                    qid = db().execute('INSERT INTO quizzes(lesson_id,pass_score) VALUES (?,?)', (l['id'], l['quiz']['pass_score'])).lastrowid
                    for q in l['quiz']['questions']:
                        db().execute('INSERT INTO questions(quiz_id,text,options,correct,explanation) VALUES (?,?,?,?,?)',
                                     (qid, q['text'], json.dumps(q['options'], ensure_ascii=False), json.dumps(q['correct']), q['explanation']))
    for lid in old_lessons - seen_lessons:
        db().execute('DELETE FROM materials WHERE lesson_id=?', (lid,))
        db().execute('DELETE FROM quizzes WHERE lesson_id=?', (lid,))
        db().execute('DELETE FROM lessons WHERE id=?', (lid,))
    for mid in old_modules - seen_modules:
        db().execute('DELETE FROM modules WHERE id=?', (mid,))
    audit('Сохранён курс: ' + status, f'{cid}: {title}')
    db().commit()
    return jsonify(editor_data(cid))


def reliable_cover(cover):
    return (cover.startswith('/static/covers/') and cover.endswith('.svg') and '..' not in cover) or one("SELECT id FROM materials WHERE '/api/media/'||id=? AND public=1 AND kind='image'", (cover,))


@admin.post('/courses/<int:cid>/archive')
def archive(cid):
    c = editor_data(cid)
    db().execute("UPDATE courses SET status='archived' WHERE id=?", (cid,))
    audit('Архивирован курс', f'{cid}: {c["title"]}')
    db().commit()
    return jsonify(ok=True)


@admin.delete('/materials/<int:mid>')
def delete_material(mid):
    m = one('SELECT * FROM materials WHERE id=? AND public=0', (mid,))
    if not m:
        abort(404, 'Материал не найден.')
    db().execute('DELETE FROM materials WHERE id=?', (mid,))
    audit('Удалён учебный материал', m['name'])
    db().commit()
    return jsonify(ok=True)
