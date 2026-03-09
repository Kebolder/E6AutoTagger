@echo off

IF NOT EXIST venv (
    echo JTP-3 requirements are not installed. Run ..\install.bat from the root folder.
    exit /b
)
call venv\Scripts\activate.bat

python inference.py %*
