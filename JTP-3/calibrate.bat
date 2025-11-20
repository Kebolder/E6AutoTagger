@echo off
title JTP-3 Hydra Calibration

echo          JTP-3 Hydra Calibration
echo =========================================
echo.
echo Press CTRL+C to cancel at any time.
echo.

set "metric="
set /p metric="Metric (cti, f0.5, f1, f2, f<beta>, j, p4; press ENTER for cti): "
if "%metric%"=="" set "metric=cti"

set "min_score="
set /p min_score="Minimum score (press ENTER for 0.0): "
if "%min_score%"=="" set "min_score=0.0"

set "min_precision="
set /p min_precision="Minimum precision (0.0 to 1.0; press ENTER for 0.098): "
if "%min_precision%"=="" set "min_precision=0.098"

set "min_recall="
set /p min_recall="Minimum recall (0.0 to 1.0; press ENTER for 0.198): "
if "%min_recall%"=="" set "min_recall=0.198"

set "min_threshold="
set /p min_threshold="Minimum threshold (0.0 to 1.0; press ENTER for none): "
if "%min_threshold%"=="" set "min_threshold=0.0"

set "max_threshold="
set /p max_threshold="Maximum threshold (0.0 to 1.0; press ENTER for none): "
if "%max_threshold%"=="" set "max_threshold=1.0"

echo.
echo Paste or write list of tags to exclude, one per line. Press ENTER to skip. At end of list, press ENTER.
echo Tags should be in e621 format, like 3d_^(artwork^). Use vulva tags instead of pussy tags.
echo.

set "exclude_tags="
:exclude_loop
set "tag="
set /p tag=
if "%tag%"=="" goto exclude_done
set "exclude_tags=%exclude_tags% %tag%"
goto exclude_loop
:exclude_done

set "cmd=python calibrate.py -m %metric% -s %min_score% -p %min_precision% -r %min_recall% -R %min_threshold% %max_threshold%"
if not "%exclude_tags%"=="" set "cmd=%cmd% -x %exclude_tags%"

echo        Calibration Command Preview
echo =========================================
echo  %cmd%
echo =========================================
echo.

:ok_loop
set "ok="
set /p ok="Ok? (y/n): "
if "%ok%"=="y" goto ok_done
if "%ok%"=="n" exit /b
goto ok_loop

:ok_done
%cmd%
pause
