@echo off
echo ========== Installing Requirements ==========
echo.

python checkver.py
if %errorlevel% neq 0 (
    echo.
    echo Try ^(re^)installing Python from https://www.python.org/downloads/windows/. Version 3.11 or later is required.
    echo.
    goto error
)

python -m venv venv
if %errorlevel% neq 0 goto error

call venv\Scripts\activate.bat
if %errorlevel% neq 0 goto venv_error

pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cu128
if %errorlevel% neq 0 goto venv_error

echo ========== Installation Successful ==========
echo.
exit /b

:venv_error
rmdir venv /s /q

:error
echo ============ Installation Failed ============
echo.
pause
exit
