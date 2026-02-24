#!/bin/bash
# BrotBack – Lokaler Server starten
# Doppelklick auf diese Datei, dann im Browser http://localhost:8080 aufrufen

DIR="$(cd "$(dirname "$0")" && pwd)"
echo "🍞 BrotBack Server startet..."
echo "👉 Öffne jetzt http://localhost:8080 in deinem Browser"
echo "   (Drücke Ctrl+C zum Beenden)"
cd "$DIR"
python3 -m http.server 8080
