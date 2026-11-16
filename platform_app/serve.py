"""Production WSGI server entry point for container platforms."""
import os

from waitress import serve

from . import create_app
from .db import migrate


def main():
    app = create_app()
    with app.app_context():
        migrate()
    port = int(os.environ.get('PORT', '10000'))
    if not 1 <= port <= 65535:
        raise ValueError('PORT must be between 1 and 65535')
    serve(app, host='0.0.0.0', port=port, threads=8)


if __name__ == '__main__':
    main()
