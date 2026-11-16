import os
import secrets
import sqlite3
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, g, jsonify, request, send_from_directory, session
from werkzeug.exceptions import HTTPException

from .db import db, init_app, one


def create_app(test_config=None):
    load_dotenv()
    root = Path(__file__).resolve().parent.parent
    app = Flask(__name__, static_folder=str(root / 'static'), template_folder=str(root / 'templates'))
    app.config.update(SECRET_KEY=os.environ.get('SECRET_KEY'),
                      DATABASE=str(root / os.environ.get('DATABASE', 'instance/platform.sqlite3')),
                      UPLOAD_FOLDER=str(root / 'instance/uploads'), MAX_CONTENT_LENGTH=10 * 1024 * 1024,
                      SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Lax',
                      PERMANENT_SESSION_LIFETIME=timedelta(days=14),
                      SESSION_COOKIE_SECURE=os.environ.get('COOKIE_SECURE') == '1')
    if test_config:
        app.config.update(test_config)
    Path(app.config['DATABASE']).parent.mkdir(parents=True, exist_ok=True)
    Path(app.config['UPLOAD_FOLDER']).mkdir(parents=True, exist_ok=True)
    init_app(app)

    @app.before_request
    def security():
        if not app.secret_key:
            return jsonify(error='Задайте SECRET_KEY в .env перед запуском.'), 503
        g.user = None
        if session.get('uid'):
            user = one('SELECT * FROM users WHERE id=?', (session['uid'],))
            if not user or user['blocked'] or user['session_version'] != session.get('version'):
                session.clear()
            else:
                g.user = user
        if 'csrf' not in session:
            session['csrf'] = secrets.token_urlsafe(32)
        if request.method in ('POST', 'PUT', 'PATCH', 'DELETE'):
            if not secrets.compare_digest(request.headers.get('X-CSRF-Token', ''), session['csrf']):
                return jsonify(error='Сессия формы устарела. Обновите страницу.'), 403
            db().execute('BEGIN IMMEDIATE')

    @app.after_request
    def headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Referrer-Policy'] = 'same-origin'
        response.headers['Content-Security-Policy'] = (
            "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; "
            "frame-src https://www.youtube-nocookie.com https://rutube.ru; "
            "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
        )
        if request.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    @app.errorhandler(Exception)
    def error_handler(error):
        if 'db' in g:
            db().rollback()
        if isinstance(error, HTTPException):
            return jsonify(error=error.description), error.code
        if isinstance(error, sqlite3.IntegrityError):
            return jsonify(error='Запись уже существует или нарушает ограничения данных.'), 409
        app.logger.exception('Ошибка запроса')
        return jsonify(error='Не удалось выполнить операцию. Попробуйте ещё раз.'), 500

    from .admin import admin
    from .api import api
    from .commands import register_commands
    app.register_blueprint(api, url_prefix='/api')
    app.register_blueprint(admin, url_prefix='/api/admin')
    register_commands(app)

    @app.get('/')
    @app.get('/<path:path>')
    def index(path=''):
        return send_from_directory(root / 'templates', 'shell.html')

    @app.get('/healthz')
    def health():
        db().execute('SELECT 1')
        return jsonify(status='ok')

    return app
