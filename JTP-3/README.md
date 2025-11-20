---
tags:
  - furry
  - e621
  - not-for-all-audiences
pipeline_tag: image-classification
base_model: google/siglip2-so400m-patch16-naflex
library_name: timm
language:
  - en
license: apache-2.0
---

<div style="text-align: center;">
  <img style="width: 60%; display: inline-block;" src="https://huggingface.co/RedRocket/JTP-3/resolve/main/data/hydra.jpg">

  <h1 style="text-align: center; margin-bottom: 0;">JTP-3 Hydra</h1>
  <div style="font-size: large;">e621 Image Classifier by <a href="https://huggingface.co/RedRocket/" style="font-size: large;">Project RedRocket</a></div>
</div>

JTP-3 Hydra is a finetune of the SigLIP2 image classifier with a custom classifier head, designed to predict 7,504 popular tags from [e621](https://e621.net).

A public demo of the model is available here: https://huggingface.co/spaces/RedRocket/JTP-3-Demo

## Downloading
If you have Git+LFS installed, download the repository using ``git clone https://huggingface.co/RedRocket/JTP-3``.

If you are unable to do this, manually download all the `.py` files, `requirements.txt`, `models/jtp-3-hydra.safetensors`, and `data/jtp-3-hydra-tags.csv`.<br>
If you are on Windows, also download the `.bat` files and follow the instructions below for easy installation.<br>
If you want to run calibration, you also need `data/jtp-3-hydra-val.csv`.

## Easy Windows Installation and Usage
For Windows, ensure you have at least Python 3.11 [installed](https://www.python.org/downloads/windows/) and available on your path.
If you are unsure about your version of Python, you can run `easy.bat` and it will let you know.

**For Windows, double-click ``easy.bat`` to run easy mode.**
Easy mode walks you through all the commands.
When easy mode asks you for a file or folder, you can drag and drop it onto the easy mode window and press enter, copy and paste the path, or type it yourself.

## Advanced Windows Installation and Usage
Double-click ``install.bat`` to run installation, which will create a virtual environment for all the requirements and install them.
You can check your version of Python by opening a command prompt and typing ``python -V``.

You can run the WebUI by double clicking ``app.bat`` and navigating your browser to the URL it shows. The link is not shared publicly.

On the command line, you can use ``inference.bat`` to do bulk operations such as tagging entire directories. Run ``inference.bat --help`` for help using the command line.
If you provide a path to a file or directory, it will write ``.txt`` caption files beside each image using the default threshold of ``0.5``.

Instead of using a fixed threshold, you can run the calibration wizard with ``calibrate.bat``.

## Linux Installation and Usage

If your OS Python install is not 3.11 or above, install a more recent version of Python according to your distribution's instructions and use that ``python`` to create the venv.
You can check your version of python with ``python -V``.

```sh
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

```sh
source venv/bin/activate
python app.py
```

```sh
source venv/bin/activate
python inference.py --help
```

## Using inference.py (or inference.bat)

If you do not have a calibration file, the default threshold of ``0.5`` is conservative. If you plan on manually reviewing the tags, consider using ``-t 0.2`` or ``-t 0.1``.

```
$ python inference.py --help
usage: inference.py [-h] [-t THRESHOLD_OR_PATH] [-i MODE] [-x CATEGORY] [-r] [-p PREFIX] [-o PATH] [-O] [-M PATH] [-m PATH] [-b BATCH_SIZE] [-w N_WORKERS] [--no-shm] [-S SEQLEN] [-d TORCH_DEVICE] [paths ...]

positional arguments:
  paths                 Path to files and directories to classify. If none are specified, run interactively.

options:
  -h, --help            show this help message and exit
  -t, --threshold THRESHOLD_OR_PATH
                        Classification threshold -1.0 to 1.0. Or, a path to a CSV calibration file. (Default: calibration.csv)
  -i, --implications MODE
                        Automatically apply implications. Requires tag metadata. (Default: inherit)
  -x, --exclude CATEGORY
                        Exclude the specified category of tags. May be specified multiple times. Requires tag metadata.
  -r, --recursive       Classify directories recursively. Dotfiles will be ignored.
  -p, --prefix PREFIX   Prefix all .txt caption files with the specified text. If the prefix matches a tag, the tag will not be repeated.
  -o, --output PATH     Path for CSV output, or '-' for standard output. If not specified, individual .txt caption files are written.
  -O, --original-tags   Do not rewrite tags for compatibility with diffusion models.
  -M, --model PATH      Path to model file.
  -m, --metadata PATH   Path to CSV file with additional tag metadata. (Default: data/jtp-3-hydra-tags.csv)
  -b, --batch BATCH_SIZE
                        Batch size.
  -w, --workers N_WORKERS
                        Number of dataloader workers. (Default: number of cores)
  --no-shm              Disable shared memory between workers.
  -S, --seqlen SEQLEN   NaFlex sequence length. (Default: 1024)
  -d, --device TORCH_DEVICE
                        Torch device. (Default: cuda)

MODE:
  inherit           Tags inherit the highest probability of the more specific tags that imply them.
  constrain         Tags are constrained to the lowest probablity of the more general tags they imply.
  remove            Exclude impled tags from output.
  constrain-remove  Combination of constrain followed by remove.
  off               No implications are applied.

CATEGORY:
  general copyright character species meta lore
```

Try to avoid running multiple copies of ``inference.py`` at once, as each copy will load the entire model.
If you are tagging only a few images, run with ``-w 0`` to use in-process dataloading.

### Interactive Mode
If you do not provide a list of files or directories to classify, ``inference.py`` will launch in an interactive mode where you can provide files one-at-a-time.

```
$ python inference.py
Loading 'models/jtp-3-hydra.safetensors' ... 7504 tags

JTP-3 Hydra Interactive Classifier
  Type 'q' to quit, or 'h' for help.
  For bulk operations, quit and run again with a path, or '-h' for help.

> h
Provide a file path to classify, or one of the following commands:
  threshold NUM      (-1.0 to 1.0, 0.2 to 0.8 recommended)
  calibration [PATH] (load calibration csv file)
  exclude CATEGORY   (general copyright character species meta lore)
  include CATEGORY   (general copyright character species meta lore)
  implications MODE  (inherit constrain remove constrain-remove off)
  seqlen LEN         (64 to 2048, 1024 recommended)
  quit               (or 'q', 'exit')
```

## Using calibrate.bat (or Easy Mode calibration)
You can just press ``ENTER`` to get the default calibration until it asks you for a list of tags to exclude.
If you don't want to exclude any tags, press ``ENTER`` again and answer ``y`` to get the default calibration.

Members of the [Furry Diffusion Community](https://discord.com/channels/1019133813105905664/1254974507819733017) may have created their own calibration files for you to try out, too.
Be cautious if anyone offers you a custom calibration file that ends in `.py` and tells you to run it. However, `.csv` calibration files are always safe.

## Usage Notes
The model predicts 7,501 e621 tags, as well as the added rating meta-tags ``safe``, ``questionable``, and ``explicit``.

The model is trained with implications, but its raw predictions are not constrained.
If you use the inference script, it will leverage the tag metadata, if available, to automatically apply implications unless you specify otherwise with ``-i off``.
For example, with implications ``off`` it's possible the model can say ``tyrannosaurus rex`` is more likely than ``dinosaur``.
In the default ``inherit`` mode, it will instead say that ``dinosaur`` is as likely as ``tyrannosaurus rex``.
In the ``constrain`` mode, it will say that ``tyrannosaurus rex`` is as likely as ``dinosaur``.

The model is trained on images on e621 only, and not on photographs of people or real animals.
While it has retained some ability to classify photos, this is not in any way supported.

The interactive interfaces use a threshold convention of -100% to 100%.
This is different from other classifier models that generally range from 0% to 100%.

The model sees all transparency as a black background.

## Technical Notes
The model consists of [SigLIP2 So400m Patch16 NAFlex](https://huggingface.co/google/siglip2-so400m-patch16-naflex) followed by a custom cross-attention transformer block with learned per-tag queries, SwiGLU feedforward, and per-tag SwiGLU output heads.
The per-tag cross attention mechanism is the origin of the moniker "hydra".

Subject to the preprocessing mentioned below, the initial set of training tags was all <span style="color:#2e76b4">general</span> tags with at least 1,200 examples, all <span style="color:#ed5d1f">species</span> and <span style="color:#00aa00">character</span> tags with at least 500 examples, a semi-automated selection of <span style="color:#dd00dd">copyright</span> and <span style="color:#666666">meta</span> tags, and a handful of manually-selected <span style="color:#228822">lore</span> tags which are sometimes discernible from the image.
This resulted in 8,067 tags. After training, tags with very poor validation performance were pruned, resulting in the final set of 7,504 tags.

Extensive semi-manual dataset curation was used to improve the quality of the training data.
The dataset preprocessing code consists of over 12,000 lines of code and data files.
In addition to correcting implications, manually-defined rules are used to detect common scenarios of missing, incomplete, or contradictory tagging and to selectively mask individual tags on a per-dataset-item basis.
This is responsible for JTP-3's excellent performance in detecting colors and "combo tags" such as `male_feral`.

Margin-focal cross entropy loss based on ASL was used to mitigate the effects of inconsistent labeling on e621 and the extreme class imbalance.
The dataset was sampled in mini-epochs according to a self-entropy metric.
Loss weight for negative labels was logarithmically redistributed from images with few tags to those with many tags.

Raw validation performance metrics and tag lists are available in the ``data`` folder.
These can be used to create P/R curves, compute CTI or F<sub>1</sub> scores, or select automated thresholds for each tag.
The list of supported tags is also embedded in the safetensors metadata as ``classifier.labels``.

Internally, the model operates on logits as normal and classification thresholds are expressed in the interval from 0.0 to 1.0.
This is reflected in the ``data`` files and csv output of ``inference.py``.

## Credits

RedHotTensors — Architecture design, dataset curation, infrastructure and training, testing, and release.<br>
DrHead — WebUI, multi-layer CAM, testing, and additional code.<br>
Thessalo — Advice and testing.<br>
[Furry Diffusion Community](https://discord.com/channels/1019133813105905664/1254974507819733017) — Feedback and compatibility fixes.<br>
Google Gemini — Hero image.

### Citations

Michael Tschannen, et al. [SigLIP 2.](https://arxiv.org/abs/2502.14786)<br>
Emanuel Ben-Baruch, et al. [Asymmetric Loss For Multi-Label Classification.](https://arxiv.org/abs/2009.14119)<br>
Noam Shazeer. [GLU Variants Improve Transformer.](https://arxiv.org/abs/2002.05202)
