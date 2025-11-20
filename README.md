# E6AutoTagger

## JTP-3 Hydra Integration

This repo now ships a custom local build of **JTP-3 Hydra** specifically wired for the E6 Autotagger.

- Original model: [RedRocket/JTP-3 on Hugging Face](https://huggingface.co/RedRocket/JTP-3)
- Custom integration: bundled in this repo under the `JTP-3/` folder, exposing a simple HTTP API at `http://127.0.0.1:7860/api/e6` for the userscript.



<<<<<<< HEAD
[Tampermonkey](https://www.tampermonkey.net/) script to allow use of a local **JTP-3 Hydra** furry auto tagger on all 3 E6‑based websites (E621, E926, E6AI).
=======
<<<<<<< HEAD
[Tampermonkey](https://www.tampermonkey.net/) script to allow use of a local **JTP-3 Hydra** furry auto tagger on all 3 E6‑based websites (E621, E926, E6AI).
=======

~Not so~ Simple [tampermonkey](https://www.tampermonkey.net/) script to allow use of [JTP Pilot](https://huggingface.co/RedRocket/JointTaggerProject) furry auto tagger on all 3 E6 based websites (E621, E629, E6AI).
>>>>>>> 79c57d246ae3424df539891073f466d381c8a410
>>>>>>> be01fd926f1a81a391f64c8464425710f7079c85


## Features
* Confidence threshold **0.1 - 1**
* Tag sort button + Setting when Generating tags
* Configurable endpoint (defaults to `http://127.0.0.1:7860/api/e6`)
* Blacklist tags from being added (Prevents tags from being added)
* Auto tag to be added (This is like a section where the User can put tags they want to be ALWAYS added)
* Anti tag nuke button (Makes it so tags don't get nuked when auto tagging things)
* Tag auto suggest (Suggests tag in the config boxes like in the normal tag box)
* Status indacator
  
![image](https://github.com/user-attachments/assets/d3247533-c95a-4e6d-a570-731baaa26fdb)
![image](https://github.com/user-attachments/assets/04575d13-6d59-48d6-962a-e86fbcc218ad)






  
## Backend Setup (Custom JTP-3)

1. Either clone this repo (which already contains `JTP-3/`), **or** download the `JTP-3.zip` asset from the latest GitHub release and extract it next to `E6AutoTagger.js`.
2. Open the `JTP-3` folder.
3. Run `install.bat` once to create the virtual environment and install all requirements (including FastAPI + Gradio).
4. After installation, run `app.bat` whenever you want to use the autotagger.
   - Wait until the console shows something like:  
     `Uvicorn running on http://127.0.0.1:7860`
5. Do **not** close this window while using the E6 Autotagger.

The userscript expects the API to be available at `http://127.0.0.1:7860/api/e6`. You can change this in the script’s configuration dialog if needed.

## Usage
* Start the custom JTP-3 backend by running `app.bat` in the `JTP-3` folder.
* Open the upload page or edit page on an E6 site and hit **"Generate Tags”**.


https://github.com/user-attachments/assets/ca3e6a6d-0d2c-4852-af98-f8aaa26abd1c


## Installation

* First install tampermonkey from plugin store [(Like chrome store)](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
* In this repo’s `JTP-3` folder, run `install.bat` once to set up the JTP-3 Hydra backend.
* After that, run `app.bat` in the `JTP-3` folder whenever you want to use the Autotagger.
* Install the script into Tampermonkey’s dashboard by dragging the `E6AutoTagger.js` file into the dashboard.
* Open an E621/E926/E6AI upload page, then hit **“Generate Tags**.

https://github.com/user-attachments/assets/7923d896-c391-48b5-9d84-c706d9f1efc2
