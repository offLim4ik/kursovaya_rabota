import io
import json

import pytest
from PIL import Image
from werkzeug.security import generate_password_hash

from platform_app import create_app
from platform_app.db import db, migrate, one


@pytest.fixture()
def app(tmp_path):
    app = create_app({'TESTING': True, 'SECRET_KEY': 'test-secret-only', 'DATABASE': str(tmp_path / 'test.sqlite'),
                      'UPLOAD_FOLDER': str(tmp_path / 'uploads')})
    with app.app_context():
        migrate()
        db().execute("INSERT INTO users(email,name,password,role) VALUES ('admin@example.test','Администратор',?,'admin')", (generate_password_hash('Admin-password-123'),))
        db().execute("INSERT INTO categories(name) VALUES ('Разработка')")
        db().commit()
    return app


def call(client, path, method='GET', body=None):
    csrf = client.get('/api/session').json['csrf']
    return client.open('/api' + path, method=method, json=body, headers={'X-CSRF-Token': csrf})


def register(client, email='student@example.test'):
    response = call(client, '/register', 'POST', {'email': email, 'name': 'Анна Тестовая', 'password': 'Student-password-123', 'role': 'admin'})
    assert response.status_code == 201
    assert response.json['user']['role'] == 'user'
    return response.json['user']


@pytest.fixture()
def admin(app):
    client = app.test_client()
    assert call(client, '/login', 'POST', {'email': 'admin@example.test', 'password': 'Admin-password-123'}).status_code == 200
    return client


@pytest.fixture()
def published(admin):
    cid = call(admin, '/admin/courses', 'POST', {'title': 'Тестовый курс'}).json['id']
    payload = {'title': 'Тестовый курс', 'summary': 'Короткое описание', 'description': 'Подробное описание курса',
               'outcomes': 'Уметь проверять приложение', 'prerequisites': 'Без подготовки', 'category_id': 1,
               'level': 'Начальный', 'status': 'published', 'cover': '', 'modules': [
                   {'title': 'Первый модуль', 'lessons': [
                       {'title': 'Первый урок', 'content': '<h2>Теория</h2><p>Изучите материал</p>', 'minutes': 10, 'video': '', 'quiz': None},
                       {'title': 'Проверка знаний', 'content': '<p>Тест</p>', 'minutes': 15, 'video': '', 'quiz': {
                           'pass_score': 70, 'questions': [
                               {'text': 'Выберите правильные ответы', 'options': ['Один', 'Два', 'Три'], 'correct': [0, 2], 'explanation': 'Первый и третий варианты верны.'}]}}]}]}
    response = call(admin, f'/admin/courses/{cid}', 'PUT', payload)
    assert response.status_code == 200, response.json
    return response.json


def test_registration_login_session_password(app):
    client = app.test_client()
    user = register(client)
    assert client.get('/api/session').json['user']['id'] == user['id']
    assert call(client, '/password', 'POST', {'current': 'wrong', 'password': 'Replacement-123'}).status_code == 400
    assert call(client, '/password', 'POST', {'current': 'Student-password-123', 'password': 'Replacement-123'}).status_code == 200
    call(client, '/logout', 'POST', {})
    assert client.get('/api/session').json['user'] is None
    assert call(client, '/login', 'POST', {'email': user['email'], 'password': 'Replacement-123'}).status_code == 200


def test_csrf_roles_and_unknown_account(app):
    client = app.test_client()
    assert client.post('/api/register', json={}).status_code == 403
    assert call(client, '/login', 'POST', {'email': 'unknown@example.test', 'password': 'incorrect'}).status_code == 401
    register(client)
    for path, method in [('/admin/overview', 'GET'), ('/admin/courses', 'POST'), ('/admin/users/1/block', 'POST')]:
        assert call(client, path, method, {} if method == 'POST' else None).status_code == 403


def test_publish_validation_and_xss(admin):
    cid = call(admin, '/admin/courses', 'POST', {'title': 'Пустой курс'}).json['id']
    c = call(admin, f'/admin/courses/{cid}').json
    c['status'] = 'published'
    assert call(admin, f'/admin/courses/{cid}', 'PUT', c).status_code == 400
    c['status'] = 'draft'
    c['modules'] = [{'title': 'Модуль', 'lessons': [{'title': 'Урок', 'content': '<img src=x onerror=alert(1)><script>alert(1)</script><strong>Текст</strong>', 'minutes': 10}]}]
    result = call(admin, f'/admin/courses/{cid}', 'PUT', c)
    assert result.status_code == 200
    body = result.json['modules'][0]['lessons'][0]['content']
    assert '<script' not in body and 'onerror' not in body and '<strong>' in body


def test_empty_and_invalid_quiz_cannot_publish(admin, published):
    c = published
    q = c['modules'][0]['lessons'][1]['quiz']
    q['questions'][0]['correct'] = []
    assert call(admin, f'/admin/courses/{c["id"]}', 'PUT', c).status_code == 400
    q['questions'] = []
    assert call(admin, f'/admin/courses/{c["id"]}', 'PUT', c).status_code == 400


def test_full_learning_flow_and_privacy(app, published):
    client = app.test_client()
    user = register(client)
    cid = published['id']
    first, second = published['modules'][0]['lessons']
    assert call(client, f'/lessons/{first["id"]}').status_code == 403
    assert call(client, f'/courses/{cid}/enroll', 'POST', {}).status_code == 200
    assert call(client, f'/courses/{cid}/enroll', 'POST', {}).status_code == 200
    with app.app_context():
        assert one('SELECT count(*) n FROM enrollments')['n'] == 1
    assert call(client, f'/lessons/{second["id"]}').status_code == 403
    call(client, f'/lessons/{first["id"]}/open', 'POST', {})
    assert call(client, '/dashboard').json['courses'][0]['progress'] == 0
    call(client, f'/lessons/{first["id"]}/note', 'PUT', {'text': 'Моя личная заметка'})
    call(client, f'/lessons/{first["id"]}/complete', 'POST', {})
    call(client, f'/lessons/{first["id"]}/complete', 'POST', {})
    assert call(client, '/dashboard').json['courses'][0]['progress'] == 50
    with app.app_context():
        assert one("SELECT count(*) n FROM events WHERE text LIKE 'Завершён урок%'")['n'] == 1
    call(client, '/logout', 'POST', {})
    call(client, '/login', 'POST', {'email': user['email'], 'password': 'Student-password-123'})
    assert call(client, '/dashboard').json['courses'][0]['resume'] == second['id']
    lesson = call(client, f'/lessons/{second["id"]}').json
    question = lesson['quiz']['questions'][0]
    assert 'correct' not in question and 'explanation' not in question
    assert call(client, f'/lessons/{second["id"]}/complete', 'POST', {}).status_code == 400
    failed = call(client, f'/lessons/{second["id"]}/attempt', 'POST', {'answers': {str(question['id']): [0]}, 'score': 100})
    assert failed.json['score'] == 0
    assert call(client, '/dashboard').json['courses'][0]['progress'] == 50
    success = call(client, f'/lessons/{second["id"]}/attempt', 'POST', {'answers': {str(question['id']): [0, 2]}})
    assert success.json['passed'] is True
    call(client, f'/lessons/{second["id"]}/attempt', 'POST', {'answers': {str(question['id']): [1]}})
    dashboard = call(client, '/dashboard').json
    assert dashboard['courses'][0]['progress'] == 100
    assert len(dashboard['certificates']) == 1
    cert = dashboard['certificates'][0]['id']
    response = call(client, f'/certificates/{cert}/pdf')
    assert response.status_code == 200 and response.data.startswith(b'%PDF')
    assert call(client, f'/courses/{cid}/review', 'POST', {'rating': 5, 'text': 'Полезный учебный курс.'}).status_code == 200
    other = app.test_client()
    register(other, 'other@example.test')
    call(other, f'/courses/{cid}/enroll', 'POST', {})
    assert call(other, f'/lessons/{first["id"]}').json['note']['text'] == ''
    assert call(other, f'/certificates/{cert}/pdf').status_code == 404
    assert call(other, f'/lessons/{second["id"]}').status_code == 403
    assert call(other, '/dashboard').json['courses'][0]['progress'] == 0


def test_block_revokes_session_and_last_admin(app, admin):
    client = app.test_client()
    u = register(client)
    assert call(admin, f'/admin/users/{u["id"]}/block', 'POST', {'blocked': True}).status_code == 200
    assert call(client, '/dashboard').status_code == 401
    assert call(client, '/login', 'POST', {'email': u['email'], 'password': 'Student-password-123'}).status_code == 401
    assert call(admin, '/admin/users/1/block', 'POST', {'blocked': True}).status_code == 400
    call(admin, f'/admin/users/{u["id"]}/block', 'POST', {'blocked': False})
    assert call(client, '/login', 'POST', {'email': u['email'], 'password': 'Student-password-123'}).status_code == 200


def test_archive_and_stable_structure(app, admin, published):
    client = app.test_client()
    register(client)
    cid = published['id']
    call(client, f'/courses/{cid}/enroll', 'POST', {})
    c = call(admin, f'/admin/courses/{cid}').json
    c['modules'][0]['lessons'].pop()
    assert call(admin, f'/admin/courses/{cid}', 'PUT', c).status_code == 400
    c = call(admin, f'/admin/courses/{cid}').json
    c['modules'][0]['lessons'][0]['title'] = 'Новое название'
    c['modules'][0]['lessons'].reverse()
    assert call(admin, f'/admin/courses/{cid}', 'PUT', c).status_code == 200
    call(admin, f'/admin/courses/{cid}/archive', 'POST', {})
    assert call(client, '/courses').json['total'] == 0
    assert call(client, f'/courses/{cid}').status_code == 200
    guest = app.test_client()
    assert call(guest, f'/courses/{cid}').status_code == 404


def test_upload_protected_material_and_avatar(app, admin, published):
    lid = published['modules'][0]['lessons'][1]['id']
    csrf = admin.get('/api/session').json['csrf']
    result = admin.post('/api/upload', data={'purpose': 'material', 'lesson_id': str(lid), 'file': (io.BytesIO(b'private lesson'), 'practice.txt')}, headers={'X-CSRF-Token': csrf})
    assert result.status_code == 200
    url = result.json['url']
    assert app.test_client().get(url).status_code == 401
    user = app.test_client()
    register(user)
    call(user, f'/courses/{published["id"]}/enroll', 'POST', {})
    assert user.get(url).status_code == 403
    first = published['modules'][0]['lessons'][0]['id']
    call(user, f'/lessons/{first}/complete', 'POST', {})
    assert user.get(url).data == b'private lesson'
    image = io.BytesIO()
    Image.new('RGB', (30, 30), 'blue').save(image, format='PNG')
    image.seek(0)
    csrf = user.get('/api/session').json['csrf']
    result = user.post('/api/upload', data={'purpose': 'avatar', 'file': (image, 'avatar.png')}, headers={'X-CSRF-Token': csrf})
    assert result.status_code == 200
    assert call(user, '/profile', 'PUT', {'name': 'Новое имя', 'avatar': result.json['url']}).status_code == 200
    bad = user.post('/api/upload', data={'purpose': 'avatar', 'file': (io.BytesIO(b'<script>bad</script>'), 'fake.png')}, headers={'X-CSRF-Token': csrf})
    assert bad.status_code == 400


def test_login_rate_limit(app):
    client = app.test_client()
    for _ in range(15):
        assert call(client, '/login', 'POST', {'email': 'bad@example.test', 'password': 'wrong'}).status_code == 401
    assert call(client, '/login', 'POST', {'email': 'bad@example.test', 'password': 'wrong'}).status_code == 429


def test_demo_and_migrations_idempotent(app):
    runner = app.test_cli_runner()
    assert runner.invoke(args=['init-db']).exit_code == 0
    result = runner.invoke(args=['seed-demo'])
    assert result.exit_code == 0, result.output
    with app.app_context():
        assert one('SELECT count(*) n FROM courses')['n'] == 6
        assert one('SELECT count(*) n FROM certificates')['n'] > 0
        assert one('SELECT count(*) n FROM reviews')['n'] > 0
        assert one('SELECT count(*) n FROM migrations')['n'] == 3
    assert runner.invoke(args=['seed-demo']).exit_code != 0


def test_public_catalog_filters_and_reviews(app, published):
    guest = app.test_client()
    assert call(guest, '/courses?q=ТЕСТОВЫЙ').json['total'] == 1
    assert call(guest, '/courses?level=Средний').json['total'] == 0
    assert call(guest, '/courses?page=abc').status_code == 400
    assert call(guest, f'/courses/{published["id"]}/enroll', 'POST', {}).status_code == 401
    register(guest)
    assert call(guest, f'/courses/{published["id"]}/review', 'POST', {'rating': 5, 'text': 'Отличный курс'}).status_code == 403


def test_attempt_history_is_personal(app, published):
    clients = [app.test_client(), app.test_client()]
    first, second = published['modules'][0]['lessons']
    for index, client in enumerate(clients):
        register(client, f'test{index}@example.test')
        call(client, f'/courses/{published["id"]}/enroll', 'POST', {})
        call(client, f'/lessons/{first["id"]}/complete', 'POST', {})
    qid = call(clients[0], f'/lessons/{second["id"]}').json['quiz']['questions'][0]['id']
    call(clients[0], f'/lessons/{second["id"]}/attempt', 'POST', {'answers': {str(qid): [0, 2]}})
    assert len(call(clients[0], f'/lessons/{second["id"]}').json['attempts']) == 1
    assert call(clients[1], f'/lessons/{second["id"]}').json['attempts'] == []


def test_server_never_accepts_foreign_lesson_ids(admin, published):
    other = call(admin, '/admin/courses', 'POST', {'title': 'Другой курс'}).json['id']
    payload = json.loads(json.dumps(published))
    assert call(admin, f'/admin/courses/{other}', 'PUT', payload).status_code == 400


def test_free_progression_can_be_configured_after_enrollment(app, admin, published):
    client = app.test_client()
    register(client)
    cid = published['id']
    second = published['modules'][0]['lessons'][1]['id']
    call(client, f'/courses/{cid}/enroll', 'POST', {})
    assert call(client, f'/lessons/{second}').status_code == 403
    config = call(admin, f'/admin/courses/{cid}').json
    config['progression'] = 'free'
    assert call(admin, f'/admin/courses/{cid}', 'PUT', config).status_code == 200
    assert call(client, f'/lessons/{second}').status_code == 200


def test_enrolled_modules_can_be_reorganized_without_losing_lesson_history(app, admin, published):
    client = app.test_client()
    register(client)
    cid = published['id']
    original = call(admin, f'/admin/courses/{cid}').json
    module = original['modules'][0]
    first, second = module['lessons']
    call(client, f'/courses/{cid}/enroll', 'POST', {})
    call(client, f'/lessons/{first["id"]}/open', 'POST', {})
    revised = {
        'title': original['title'], 'summary': original['summary'], 'description': original['description'],
        'outcomes': original['outcomes'], 'prerequisites': original['prerequisites'],
        'category_id': original['category_id'], 'level': original['level'], 'status': 'published',
        'cover': original['cover'], 'progression': 'free',
        'modules': [
            {'id': module['id'], 'title': 'Основы', 'description': 'Ключевые понятия и разбор задачи.',
             'outcomes': 'Объяснить базовые понятия', 'unlock_after_module_id': None,
             'lessons': [{k: first[k] for k in ('id', 'title', 'content', 'video', 'minutes', 'quiz')}]},
            {'title': 'Практика', 'description': 'Примените знания на новом примере.',
             'outcomes': 'Решить задачу самостоятельно', 'unlock_after_module_id': module['id'],
             'lessons': [{k: second[k] for k in ('id', 'title', 'content', 'video', 'minutes', 'quiz')}]},
        ],
    }
    saved = call(admin, f'/admin/courses/{cid}', 'PUT', revised)
    assert saved.status_code == 200, saved.json
    assert len(saved.json['modules']) == 2
    assert saved.json['modules'][0]['description'] == 'Ключевые понятия и разбор задачи.'
    assert saved.json['modules'][1]['unlock_after_module_id'] == module['id']
    assert call(client, f'/lessons/{first["id"]}').status_code == 200
    assert call(client, f'/lessons/{second["id"]}').status_code == 403
    with app.app_context():
        progress = one('SELECT started_at,completed_at FROM progress WHERE lesson_id=?', (first['id'],))
        assert progress['started_at'] and progress['completed_at'] is None
        assert one('SELECT id FROM progress WHERE lesson_id=?', (second['id'],)) is None


def test_module_cannot_depend_on_itself_or_a_later_module(admin, published):
    original = call(admin, f'/admin/courses/{published["id"]}').json
    module = original['modules'][0]
    payload = {
        'title': original['title'], 'summary': original['summary'], 'description': original['description'],
        'outcomes': original['outcomes'], 'prerequisites': original['prerequisites'],
        'category_id': original['category_id'], 'level': original['level'], 'status': 'published',
        'cover': original['cover'], 'progression': 'sequential',
        'modules': [{'id': module['id'], 'title': module['title'], 'unlock_after_module_id': module['id'],
                     'lessons': [{k: l[k] for k in ('id', 'title', 'content', 'video', 'minutes', 'quiz')}
                                 for l in module['lessons']]}],
    }
    assert call(admin, f'/admin/courses/{published["id"]}', 'PUT', payload).status_code == 400
