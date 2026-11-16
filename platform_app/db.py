import sqlite3
from pathlib import Path

import click
from flask import current_app, g


def db():
    if 'db' not in g:
        g.db = sqlite3.connect(current_app.config['DATABASE'], timeout=20)
        g.db.row_factory = sqlite3.Row
        g.db.execute('PRAGMA foreign_keys=ON')
        g.db.create_function('casefold', 1, lambda value: str(value).casefold())
    return g.db


def rows(sql, args=()):
    return [dict(row) for row in db().execute(sql, args).fetchall()]


def one(sql, args=()):
    row = db().execute(sql, args).fetchone()
    return dict(row) if row else None


def migrate():
    connection = db()
    connection.execute('CREATE TABLE IF NOT EXISTS migrations(version TEXT PRIMARY KEY)')
    for path in sorted((Path(__file__).parent.parent / 'migrations').glob('*.sql')):
        if not one('SELECT version FROM migrations WHERE version=?', (path.name,)):
            script = 'BEGIN IMMEDIATE;\n' + path.read_text(encoding='utf-8')
            script += "\nINSERT INTO migrations(version) VALUES ('" + path.name + "');\nCOMMIT;"
            connection.executescript(script)


def init_app(app):
    @app.teardown_appcontext
    def close_db(error=None):
        connection = g.pop('db', None)
        if connection:
            connection.close()

    @app.cli.command('init-db')
    def init_db():
        migrate()
        click.echo('Миграции применены.')
