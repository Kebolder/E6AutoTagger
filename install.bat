@echo off
setlocal EnableExtensions

echo ========== JTP-3 Model Setup ==========
echo.

set "ROOT_DIR=%~dp0"
set "JTP3_DIR=%ROOT_DIR%JTP-3"
set "MODELS_DIR=%JTP3_DIR%\models"
set "MODEL_PATH=%MODELS_DIR%\jtp-3-hydra.safetensors"
set "MODEL_URL=https://huggingface.co/RedRocket/JTP-3/resolve/main/models/jtp-3-hydra.safetensors?download=true"
set "PYTHON_TARGET="
set "PYTHON_TARGET_EXE="
set "PYTHON_CMD="
set "ACTIVE_PYTHON_VERSION="
set "ACTIVE_PYTHON_EXE="

REM Prefer Python 3.13, then 3.12 via py launcher
where py >nul 2>nul
if %errorlevel% equ 0 (
    py -3.13 -V >nul 2>nul
    if %errorlevel% equ 0 (
        set "PYTHON_TARGET=3.13"
        for /f "delims=" %%I in ('py -3.13 -c "import sys; print(sys.executable)" 2^>nul') do set "PYTHON_TARGET_EXE=%%I"
    ) else (
        py -3.12 -V >nul 2>nul
        if %errorlevel% equ 0 (
            set "PYTHON_TARGET=3.12"
            for /f "delims=" %%I in ('py -3.12 -c "import sys; print(sys.executable)" 2^>nul') do set "PYTHON_TARGET_EXE=%%I"
        )
    )
)

for /f "tokens=2 delims= " %%I in ('python --version 2^>^&1') do set "ACTIVE_PYTHON_VERSION=%%I"
for /f "delims=" %%I in ('python -c "import sys; print(sys.executable)" 2^>nul') do set "ACTIVE_PYTHON_EXE=%%I"

REM Fallback to default python if it is already 3.13 or 3.12
if not defined PYTHON_TARGET if defined ACTIVE_PYTHON_VERSION (
    echo %ACTIVE_PYTHON_VERSION% | findstr /b /c:"3.13" >nul
    if %errorlevel% equ 0 (
        set "PYTHON_TARGET=3.13"
        set "PYTHON_TARGET_EXE=python"
    ) else (
        echo %ACTIVE_PYTHON_VERSION% | findstr /b /c:"3.12" >nul
        if %errorlevel% equ 0 (
            set "PYTHON_TARGET=3.12"
            set "PYTHON_TARGET_EXE=python"
        )
    )
)

if defined ACTIVE_PYTHON_VERSION (
    echo Detected default Python: %ACTIVE_PYTHON_VERSION%
    if defined ACTIVE_PYTHON_EXE echo Default interpreter: %ACTIVE_PYTHON_EXE%
)

if not defined PYTHON_TARGET (
    echo.
    echo WARNING: Python 3.12 or 3.13 was not found.
    if defined ACTIVE_PYTHON_VERSION (
        echo Current default Python is %ACTIVE_PYTHON_VERSION%.
    )
    echo This installer only supports Python 3.12 or 3.13.
    echo.
    echo Install one of these first:
    echo   - Python 3.13
    echo   - Python 3.12
    echo.
    echo After installing, rerun this file.
    pause
    exit /b 1
)

if /i "%PYTHON_TARGET_EXE%"=="python" (
    set "PYTHON_CMD=python"
    echo Using Python %PYTHON_TARGET% for installation.
    if defined ACTIVE_PYTHON_EXE (
        echo Interpreter: %ACTIVE_PYTHON_EXE%
    ) else (
        echo Interpreter: python
    )
) else (
    set "PYTHON_CMD=%PYTHON_TARGET_EXE%"
    echo Using Python %PYTHON_TARGET% for installation.
    echo Interpreter: %PYTHON_TARGET_EXE%
)
echo.

REM Warn if shell default is not 3.12/3.13
if defined ACTIVE_PYTHON_VERSION (
    echo %ACTIVE_PYTHON_VERSION% | findstr /b /c:"3.12" >nul
    if %errorlevel% neq 0 (
        echo %ACTIVE_PYTHON_VERSION% | findstr /b /c:"3.13" >nul
        if %errorlevel% neq 0 (
            echo WARNING: Default Python is %ACTIVE_PYTHON_VERSION%, which is not supported for install.
            echo The installer will use Python %PYTHON_TARGET% instead.
            echo.
        )
    )
)

if not exist "%JTP3_DIR%\." (
    echo ERROR: Missing JTP-3 directory.
    pause
    exit /b 1
)

if not exist "%JTP3_DIR%\requirements.txt" (
    echo ERROR: Missing JTP-3\requirements.txt.
    pause
    exit /b 1
)

REM Create models directory if it does not exist
if not exist "%MODELS_DIR%\." (
    echo Creating JTP-3\models folder...
    mkdir "%MODELS_DIR%" >nul 2>nul
    if not exist "%MODELS_DIR%\." (
        echo Failed to create JTP-3\models folder.
        pause
        exit /b 1
    )
)

set "MODEL_READY=0"
set "MODEL_TMP=%MODEL_PATH%.download"

REM If a prior run left a temp file, try to promote it first.
if exist "%MODEL_TMP%" (
    call :validate_model "%MODEL_TMP%"
    if not errorlevel 1 (
        move /y "%MODEL_TMP%" "%MODEL_PATH%" >nul
        if errorlevel 1 (
            copy /y "%MODEL_TMP%" "%MODEL_PATH%" >nul
            del /f /q "%MODEL_TMP%" >nul 2>nul
        )
    ) else (
        del /f /q "%MODEL_TMP%" >nul 2>nul
    )
)

call :validate_model "%MODEL_PATH%"
if %errorlevel% equ 0 (
    echo Model file already exists and is valid, skipping download.
    set "MODEL_READY=1"
) else (
    echo Existing model is missing or invalid. Attempting download...
    if exist "%MODEL_TMP%" del /f /q "%MODEL_TMP%" >nul 2>nul

    echo.
    echo Downloading jtp-3-hydra.safetensors from HuggingFace...
    echo This may take a while as the file is large...
    echo.

    call :download_model "%MODEL_TMP%"
    if errorlevel 1 (
        call :validate_model_loose "%MODEL_TMP%"
        if errorlevel 1 (
            echo.
            echo WARNING: Failed to download the model automatically.
        ) else (
            echo.
            echo WARNING: Downloader returned a non-zero status, but a large file was downloaded.
            echo Continuing with model validation.
        )
    )
    if exist "%MODEL_TMP%" (
        for %%F in ("%MODEL_TMP%") do echo Downloaded bytes: %%~zF
        call :validate_model "%MODEL_TMP%"
        if errorlevel 1 (
            call :validate_model_loose "%MODEL_TMP%"
            if errorlevel 1 (
                echo.
                echo WARNING: Download finished but model validation failed.
                del /f /q "%MODEL_TMP%" >nul 2>nul
            ) else (
                echo.
                echo WARNING: Strict validation failed, but downloaded file looks complete.
                echo Promoting downloaded file to model path anyway.
                move /y "%MODEL_TMP%" "%MODEL_PATH%" >nul
                if errorlevel 1 (
                    copy /y "%MODEL_TMP%" "%MODEL_PATH%" >nul
                    del /f /q "%MODEL_TMP%" >nul 2>nul
                )
                set "MODEL_READY=1"
            )
        ) else (
            move /y "%MODEL_TMP%" "%MODEL_PATH%" >nul
            if errorlevel 1 (
                copy /y "%MODEL_TMP%" "%MODEL_PATH%" >nul
                del /f /q "%MODEL_TMP%" >nul 2>nul
            )
            call :validate_model "%MODEL_PATH%"
            if not errorlevel 1 (
                echo Model downloaded successfully!
                set "MODEL_READY=1"
            )
        )
    )
)

if "%MODEL_READY%"=="0" (
    call :validate_model_loose "%MODEL_PATH%"
    if not errorlevel 1 (
        echo.
        echo WARNING: Strict model check failed, but an existing large model file was found.
        echo Continuing installation and leaving the current model file in place.
        set "MODEL_READY=1"
    )
)

if "%MODEL_READY%"=="0" (
    echo.
    echo WARNING: No valid model was confirmed.
    echo You can manually download:
    echo %MODEL_URL%
    echo Place it in:
    echo %MODEL_PATH%
    echo.
    echo Continuing to install Python environment anyway.
)

REM Never keep temp download file around.
if exist "%MODEL_TMP%" del /f /q "%MODEL_TMP%" >nul 2>nul

echo.
echo ========== Installing JTP-3 Requirements ==========
echo.

pushd "%JTP3_DIR%"
if %errorlevel% neq 0 (
    echo Failed to enter JTP-3 directory.
    pause
    exit /b 1
)

"%PYTHON_CMD%" -m venv venv
if %errorlevel% neq 0 goto install_error

call venv\Scripts\activate.bat
if %errorlevel% neq 0 goto venv_error

python -m pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cu128
if %errorlevel% neq 0 goto venv_error

popd

echo.
echo ========== All Setup Complete ==========
echo You can now run app.bat to start the application.
echo.
pause
exit /b 0

:download_model
set "DL_PATH=%~1"
if exist "%DL_PATH%" del /f /q "%DL_PATH%" >nul 2>nul

REM First try curl (handles redirects and fail-fast on HTTP errors)
where curl.exe >nul 2>nul
if not errorlevel 1 (
    curl.exe -L --fail --retry 3 --retry-delay 2 -A "E6AutoTagger-Installer/1.0" -o "%DL_PATH%" "%MODEL_URL%"
    if not errorlevel 1 (
        call :validate_model_loose "%DL_PATH%"
        if not errorlevel 1 exit /b 0
    )
)

REM Fallback to PowerShell web request
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -Uri '%MODEL_URL%' -OutFile '%DL_PATH%' -UseBasicParsing -MaximumRedirection 10 -Headers @{ 'User-Agent'='E6AutoTagger-Installer/1.0' } -ErrorAction Stop; exit 0 } catch { exit 1 }"
if errorlevel 1 exit /b 1
call :validate_model_loose "%DL_PATH%"
exit /b %errorlevel%

:validate_model
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='%~1'; if(!(Test-Path $p)){exit 2}; $len=(Get-Item $p).Length; if($len -lt 104857600){exit 1}; try { $fs=[System.IO.File]::OpenRead($p); try{ $buf=New-Object byte[] 256; $read=$fs.Read($buf,0,$buf.Length) } finally { $fs.Dispose() }; $head=[System.Text.Encoding]::ASCII.GetString($buf,0,$read).ToLowerInvariant(); if($head.StartsWith('version https://git-lfs.github.com/spec/v1')){exit 1}; if($head.StartsWith(([string][char]60)+'!doctype html') -or $head.StartsWith(([string][char]60)+'html')){exit 1}; exit 0 } catch { exit 3 }"
exit /b %errorlevel%

:validate_model_loose
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='%~1'; if(!(Test-Path $p)){exit 2}; $len=(Get-Item $p).Length; if($len -ge 104857600){exit 0}; exit 1"
exit /b %errorlevel%

:venv_error
rmdir /s /q venv

:install_error
popd
echo.
echo JTP-3 installation failed.
echo.
pause
exit /b 1
