@echo off
echo ========== JTP-3 Model Setup ==========
echo.
set "MODEL_PATH=JTP-3\models\jtp-3-hydra.safetensors"

REM Create Models directory if it doesn't exist
if not exist "JTP-3\models" (
    echo Creating JTP-3\Models folder...
    mkdir "JTP-3\models"
    if %errorlevel% neq 0 (
        echo Failed to create JTP-3\Models folder!
        pause
        exit /b 1
    )
)

set "MODEL_NEEDS_DOWNLOAD=0"

REM Check if the model exists and looks valid
if not exist "%MODEL_PATH%" (
    set "MODEL_NEEDS_DOWNLOAD=1"
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='%MODEL_PATH%'; if(!(Test-Path $p)){exit 2}; $len=(Get-Item $p).Length; if($len -lt 104857600){exit 1}; $fs=[System.IO.File]::OpenRead($p); try{ $buf=New-Object byte[] 256; $read=$fs.Read($buf,0,$buf.Length) } finally { $fs.Dispose() }; $head=[System.Text.Encoding]::ASCII.GetString($buf,0,$read).ToLowerInvariant(); if($head.StartsWith('version https://git-lfs.github.com/spec/v1')){exit 1}; if($head.StartsWith(([string][char]60)+'!doctype html') -or $head.StartsWith(([string][char]60)+'html')){exit 1}; exit 0"
    if %errorlevel% neq 0 set "MODEL_NEEDS_DOWNLOAD=1"
)

if "%MODEL_NEEDS_DOWNLOAD%"=="1" (
    if exist "%MODEL_PATH%" (
        echo Existing model file looks invalid. Re-downloading...
        del /f /q "%MODEL_PATH%"
    )

    echo.
    echo Downloading jtp-3-hydra.safetensors from HuggingFace...
    echo This may take a while as the file is large...
    echo.
    
    REM Try using PowerShell to download the file
    powershell -NoProfile -ExecutionPolicy Bypass -Command "& {$ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -Uri 'https://huggingface.co/RedRocket/JTP-3/resolve/main/models/jtp-3-hydra.safetensors' -OutFile '%MODEL_PATH%' -UseBasicParsing } catch { exit 1 }}"
    
    if %errorlevel% neq 0 (
        echo.
        echo Failed to download the model file automatically.
        echo Please manually download the model from:
        echo https://huggingface.co/RedRocket/JTP-3/resolve/main/models/jtp-3-hydra.safetensors
        echo And place it in the JTP-3\Models folder.
        echo.
        pause
        exit /b 1
    )

    powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='%MODEL_PATH%'; if(!(Test-Path $p)){exit 2}; $len=(Get-Item $p).Length; if($len -lt 104857600){exit 1}; $fs=[System.IO.File]::OpenRead($p); try{ $buf=New-Object byte[] 256; $read=$fs.Read($buf,0,$buf.Length) } finally { $fs.Dispose() }; $head=[System.Text.Encoding]::ASCII.GetString($buf,0,$read).ToLowerInvariant(); if($head.StartsWith('version https://git-lfs.github.com/spec/v1')){exit 1}; if($head.StartsWith(([string][char]60)+'!doctype html') -or $head.StartsWith(([string][char]60)+'html')){exit 1}; exit 0"
    if %errorlevel% neq 0 (
        echo.
        echo Download finished, but the file is still invalid or incomplete.
        echo Delete %MODEL_PATH% and try running install.bat again.
        pause
        exit /b 1
    )
    
    echo Model downloaded successfully!
) else (
    echo Model file already exists, skipping download.
)

echo.
echo ========== Running JTP-3 Installation ==========
echo.

REM Run the actual JTP-3 installer
cd JTP-3
call install.bat

if %errorlevel% neq 0 (
    echo.
    echo JTP-3 installation failed!
    pause
    exit /b 1
)

echo.
echo ========== All Setup Complete ==========
echo You can now run app.bat to start the application.
echo.
pause
