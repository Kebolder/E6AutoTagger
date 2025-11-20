@echo off
title JTP-3 Hydra

echo           JTP-3 Hydra Easy Mode
echo =========================================
echo.

IF EXIST venv goto ready

:install_loop
set "ok="
set /p ok="Would you like to install JTP-3 requirements here? (y/n): "
if "%ok%"=="y" goto install
if "%ok%"=="n" exit /b
goto install_loop

:install
call .\install.bat

:ready
call venv\Scripts\activate.bat

:menu
echo Main Commands:
echo   autotag: Provide a file or folder to classify.
echo   app: Start the JTP-3 WebUI with CAM visualization.
echo   exit: Close easy mode.
echo.
echo Additional Commands:
echo   calibrate: Run the JTP-3 calibration wizard. You can use this to exclude tags too.
echo   interactive: Run the interactive classifier.
echo   update: Update to the latest version of JTP-3. Requires git.
echo.

:action_loop
set "action="
set /p action="What would you like to do? "
if "%action%"=="autotag" goto autotag
if "%action%"=="inference" goto autotag
if "%action%"=="app" goto app
if "%action%"=="calibrate" goto calibrate
if "%action%"=="interactive" goto interactive
if "%action%"=="update" goto update
if "%action%"=="exit" exit /b
goto action_loop

:autotag
echo.
echo ========== AUTOTAGGING ==========
if EXIST calibration.csv (
    set "threshold=calibration.csv"
) else (
    set /p threshold="Threshold (-1.0 to 1.0; press ENTER for 0.2): "
    if "%threshold%"=="" set "threshold=0.2"
)

:target_loop
set "target="
set /p target="Path (folder or file): "
if "%target%"=="" (
    echo.
    goto menu
)
if NOT EXIST "%target%" (
    echo   File or folder could not be found.
    goto target_loop
)
set "recurse="
set /p recurse="Autotag folders inside (y, or anything else for no): "
if "%recurse%"=="y" (
    set "recurse=-r"
) else (
    set "recurse="
)

echo.
python inference.py -t "%threshold%" "%recurse%" "%target%"
echo.
goto target_loop

:app
echo.
call .\app.bat
echo.
goto menu

:calibrate
echo.
call .\calibrate.bat
echo.
goto menu

:interactive
echo.
python inference.py
echo.
goto menu

:update
echo.
git pull
echo.
goto menu
