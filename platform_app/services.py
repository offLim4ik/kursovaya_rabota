import json
import re
import uuid
from functools import wraps

import bleach
from flask import abort, g, request

from .db import db, one, rows


def require(admin=False):
    def decorator(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            if not g.user:
                abort(401, 'Войдите в аккаунт.')
            if admin and g.user['role'] != 'admin':
                abort(403, 'Доступ только для администратора.')
            return fn(*args, **kwargs)
        return wrapped
    return decorator


def data():
    value = request.get_json(silent=True)
    if not isinstance(value, dict):
        abort(400, 'Ожидается JSON-объект.')
    return value


def text(value, minimum=0, maximum=10000):
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum:
        abort(400, f'Текст должен содержать от {minimum} до {maximum} символов.')
    return value.strip()


def person_name(value):
    """Accept names made of Unicode letters separated by spaces."""
    value = text(value, 2, 80)
    normalized = ' '.join(value.split())
    if any(not (character.isalpha() or character == ' ') for character in normalized):
        abort(400, 'Имя может содержать только буквы и пробелы.')
    return normalized


def integer(value, minimum=1, maximum=1000000):
    try:
        number = int(value)
    except (TypeError, ValueError):
        abort(400, 'Ожидается целое число.')
    if not minimum <= number <= maximum:
        abort(400, f'Число должно быть от {minimum} до {maximum}.')
    return number


def clean(value):
    return bleach.clean(text(value, maximum=100000), tags=['p', 'br', 'h2', 'h3', 'strong', 'em',
                        'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'a'],
                        attributes={'a': ['href', 'title']}, protocols=['https'], strip=True)


def video_url(value):
    value = text(value, maximum=250)
    if value and not re.fullmatch(r'https://(?:www\.youtube-nocookie\.com/embed/[\w-]+|rutube\.ru/play/embed/[\w-]+/?)', value):
        abort(400, 'Разрешены embed-ссылки youtube-nocookie.com и rutube.ru.')
    return value


def public_user(user):
    return {key: user[key] for key in ('id', 'email', 'name', 'role', 'avatar', 'blocked', 'created_at')}


def event(uid, cid, message, notify=False):
    db().execute('INSERT INTO events(user_id,course_id,text) VALUES (?,?,?)', (uid, cid, message))
    if notify:
        db().execute('INSERT INTO notifications(user_id,text) VALUES (?,?)', (uid, message))


def audit(action, obj):
    db().execute('INSERT INTO audit(user_id,action,object) VALUES (?,?,?)', (g.user['id'], action, str(obj)))


def lessons(cid):
    return rows('SELECT l.*,m.title module_title,m.position module_position,m.description module_description,'
                'm.outcomes module_outcomes,m.unlock_after_module_id,pm.title prerequisite_module_title '
                'FROM lessons l JOIN modules m ON m.id=l.module_id '
                'LEFT JOIN modules pm ON pm.id=m.unlock_after_module_id '
                'WHERE m.course_id=? ORDER BY m.position,m.id,l.position,l.id', (cid,))


def enrollment(cid, uid=None):
    return one('SELECT * FROM enrollments WHERE course_id=? AND user_id=?', (cid, uid or g.user['id']))


def course(cid):
    c = one('SELECT c.*,cat.name category FROM courses c LEFT JOIN categories cat ON cat.id=c.category_id '
            'WHERE c.id=?', (cid,))
    if not c:
        abort(404, 'Курс не найден.')
    if c['status'] != 'published' and not (g.user and (g.user['role'] == 'admin' or enrollment(cid))):
        abort(404, 'Курс не найден.')
    return c


def curriculum(cid, e=None, contents=False):
    progression = c_progression(cid)
    done = {}
    if e:
        done = {p['lesson_id']: p for p in rows('SELECT * FROM progress WHERE enrollment_id=?', (e['id'],))}
    module_lessons: dict[int, list[int]] = {}
    for item in lessons(cid):
        module_lessons.setdefault(item['module_id'], []).append(item['id'])
    modules = {m['id']: m for m in rows('SELECT id,unlock_after_module_id FROM modules WHERE course_id=?', (cid,))}
    module_open = {}
    for mid, module in modules.items():
        prerequisite = module['unlock_after_module_id']
        module_open[mid] = not prerequisite or all(
            done.get(lid) and done[lid]['completed_at'] for lid in module_lessons.get(prerequisite, [])
        )
    previous_done = True
    result = []
    for lesson in lessons(cid):
        p = done.get(lesson['id'])
        finished = p and p['completed_at']
        accessible = bool(e and (e['completed_at'] or finished or (module_open.get(lesson['module_id'], False)
                           and (progression == 'free' or previous_done))))
        lesson['state'] = 'completed' if finished else ('started' if p and accessible else 'available' if accessible else 'locked')
        lesson['accessible'] = accessible
        lesson['lock_reason'] = (f"Сначала завершите модуль «{lesson['prerequisite_module_title']}»"
                                 if not module_open.get(lesson['module_id'], False) else 'Сначала завершите предыдущий урок')
        lesson['has_quiz'] = bool(one('SELECT id FROM quizzes WHERE lesson_id=?', (lesson['id'],)))
        if not contents:
            lesson.pop('content')
            lesson.pop('video')
        result.append(lesson)
        previous_done = bool(previous_done and finished)
    return result


def c_progression(cid):
    value = one('SELECT progression FROM courses WHERE id=?', (cid,))
    return value['progression'] if value else 'sequential'


def summary(c, uid=None):
    c = dict(c)
    if 'category' not in c:
        category = one('SELECT name FROM categories WHERE id=?', (c['category_id'],))
        c['category'] = category['name'] if category else ''
    ls = lessons(c['id'])
    c['lesson_count'] = len(ls)
    c['minutes'] = sum(x['minutes'] for x in ls)
    c['enrolled_count'] = one('SELECT count(*) n FROM enrollments WHERE course_id=?', (c['id'],))['n']
    c['rating'] = one('SELECT round(avg(rating),1) n FROM reviews WHERE course_id=?', (c['id'],))['n']
    e = enrollment(c['id'], uid) if uid else None
    c['enrollment'] = e
    c['favorite'] = bool(uid and one('SELECT 1 FROM favorites WHERE user_id=? AND course_id=?', (uid, c['id'])))
    completed_lessons = rows('SELECT lesson_id FROM progress WHERE enrollment_id=? AND completed_at IS NOT NULL',
                             (e['id'],)) if e else []
    completed_ids = {item['lesson_id'] for item in completed_lessons}
    c['done'] = len(completed_ids)
    c['progress'] = 100 if e and e['completed_at'] else round(c['done'] / max(1, len(ls)) * 100)
    c['resume'] = None
    c['resume_title'] = None
    c['resume_module_title'] = None
    c['resume_minutes'] = 0
    c['remaining_minutes'] = sum(item['minutes'] for item in ls if item['id'] not in completed_ids)
    if e:
        plan = curriculum(c['id'], e)
        available = [x for x in plan if x['accessible']]
        preferred = next((x for x in available if x['id'] == e['last_lesson'] and x['state'] != 'completed'), None)
        target = preferred or next((x for x in available if x['state'] != 'completed'), None) or (available[-1] if available else None)
        c['resume'] = target['id'] if target else None
        c['resume_title'] = target['title'] if target else None
        c['resume_module_title'] = target['module_title'] if target else None
        c['resume_minutes'] = target['minutes'] if target else 0
    return c


def lesson_access(lid):
    l = one('SELECT l.*,m.course_id FROM lessons l JOIN modules m ON m.id=l.module_id WHERE l.id=?', (lid,))
    if not l:
        abort(404, 'Урок не найден.')
    e = enrollment(l['course_id'])
    if not e:
        abort(403, 'Сначала запишитесь на курс.')
    plan = curriculum(l['course_id'], e)
    if not next(x for x in plan if x['id'] == lid)['accessible']:
        abort(403, 'Сначала завершите предыдущие уроки.')
    return l, e


def complete(l, e):
    db().execute('INSERT OR IGNORE INTO progress(enrollment_id,lesson_id) VALUES (?,?)', (e['id'], l['id']))
    changed = db().execute('UPDATE progress SET completed_at=CURRENT_TIMESTAMP WHERE enrollment_id=? '
                           'AND lesson_id=? AND completed_at IS NULL', (e['id'], l['id'])).rowcount
    db().execute('UPDATE enrollments SET last_activity=CURRENT_TIMESTAMP,last_lesson=? WHERE id=?', (l['id'], e['id']))
    if changed:
        event(e['user_id'], e['course_id'], 'Завершён урок «' + l['title'] + '»')
    count = one('SELECT count(*) n FROM progress WHERE enrollment_id=? AND completed_at IS NOT NULL', (e['id'],))['n']
    if count == len(lessons(e['course_id'])) and not e['completed_at']:
        db().execute('UPDATE enrollments SET completed_at=CURRENT_TIMESTAMP WHERE id=?', (e['id'],))
        c = one('SELECT * FROM courses WHERE id=?', (e['course_id'],))
        user = one('SELECT * FROM users WHERE id=?', (e['user_id'],))
        db().execute('INSERT OR IGNORE INTO certificates(id,enrollment_id,name,course) VALUES (?,?,?,?)',
                     (str(uuid.uuid4()), e['id'], user['name'], c['title']))
        event(e['user_id'], e['course_id'], 'Завершён курс «' + c['title'] + '». Сертификат готов!', True)


def quiz_data(lid, answers=False):
    q = one('SELECT * FROM quizzes WHERE lesson_id=?', (lid,))
    if not q:
        return None
    q['questions'] = rows('SELECT * FROM questions WHERE quiz_id=? ORDER BY id', (q['id'],))
    for question in q['questions']:
        question['options'] = json.loads(question['options'])
        question['multiple'] = len(json.loads(question['correct'])) > 1
        if answers:
            question['correct'] = json.loads(question['correct'])
        else:
            question.pop('correct')
            question.pop('explanation')
    return q
