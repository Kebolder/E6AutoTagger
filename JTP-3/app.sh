#!/usr/bin/env bash

set -e

cd "$(dirname "$0")"

if [ ! -d "venv" ]; then
  echo "JTP-3 requirements are not installed."
  echo "On Linux, from this folder run:"
  echo "  python -m venv venv"
  echo "  source venv/bin/activate"
  echo "  pip install -r requirements.txt"
  exit 1
fi

if [ -f "venv/bin/activate" ]; then
  . "venv/bin/activate"
elif [ -f "venv/Scripts/activate" ]; then
  . "venv/Scripts/activate"
fi

echo "To view the WebUI, open the link after \"Running on local URL:\" in your browser."
echo "Do not close this terminal until you are done using the WebUI."
echo

python app.py