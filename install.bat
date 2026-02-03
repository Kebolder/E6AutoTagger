@echo off
echo ========== JTP-3 Model Setup ==========
echo.

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

REM Check if the model file already exists
if not exist "JTP-3\models\jtp-3-hydra.safetensors" (
    echo.
    echo Downloading jtp-3-hydra.safetensors from HuggingFace...
    echo This may take a while as the file is large...
    echo.
    
    REM Try using PowerShell to download the file
    powershell -Command "& {$ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -Uri 'https://huggingface.co/RedRocket/JTP-3/resolve/main/models/jtp-3-hydra.safetensors' -OutFile 'JTP-3\models\jtp-3-hydra.safetensors' -UseBasicParsing } catch { exit 1 }}"
    
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
