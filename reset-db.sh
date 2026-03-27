#!/bin/bash
# Reset the Tinybox database by deleting the database file

DB_PATH="database/tinybox.db"

if [ -f "$DB_PATH" ]; then
    rm -f "$DB_PATH"
    echo "✓ Database deleted successfully"
    echo "The database will be recreated with fresh tables on next server start"
else
    echo "✗ Database file not found at $DB_PATH"
fi
