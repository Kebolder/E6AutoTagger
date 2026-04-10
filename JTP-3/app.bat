@rem Modified by Kebolder for E6AutoTagger.
@rem Original file remains licensed under the Apache License, Version 2.0. See /LICENSE.

@echo off

IF NOT EXIST venv (
    echo JTP-3 requirements are not installed. Run ..\install.bat from the root folder.
    exit /b
)
call venv\Scripts\activate.bat

echo To view the WebUI, copy and paste the link after "Running on local URL:" into your web browser.
echo Do not close this window until you are done using the WebUI.
echo.

python app.py
