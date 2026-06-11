"""tools — Scripts CLI Hypocampus (rectifications batch, migrations).

Chaque script doit être lancé en module :
    python -m tools.<script_name> [options]

Tous les scripts respectent les contraintes de sécurité projet :
- Atomic writes via core.storage.write_json_file
- Audit log via core.storage.audit
- Backup auto via core.storage.BackupManager au premier write
"""
