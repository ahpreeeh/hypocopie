"""
Handlers HTTP par domaine.

Chaque module ici expose des fonctions `handle_*(handler, **context)` qui :
- Reçoivent le `Handler` BaseHTTPRequestHandler en premier argument (pour `_send_json` etc.)
- Reçoivent en kwargs les dépendances applicatives (backup_manager, audit_log, paths, etc.)
- N'importent PAS server.py (évite les imports circulaires)

server.py reste le dispatcher : `if path == "...": handlers.admin.handle_backup_post(self, backup_manager=...)`.

Issu de Phase 1 de la modularisation.
"""
