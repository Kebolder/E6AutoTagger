@echo off

IF NOT EXIST venv (
    echo JTP-3 requirements are not installed. Run install.bat to install.
    exit /b
)
call venv\Scripts\activate.bat

python inference.py %*
