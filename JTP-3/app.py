import base64
import csv
import os
from io import BytesIO, StringIO
from threading import Lock

import numpy as np

import torch
from torch import Tensor
from torch.nn import Parameter
from torch.nn.functional import sigmoid

import gradio as gr
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from PIL import Image, ImageDraw, ImageFont

import requests

from model import load_model, process_image, patchify_image
from image import unpatchify

PATCH_SIZE = 16
MAX_SEQ_LEN = 1024

device = "cuda" if torch.cuda.is_available() else "cpu"
if hasattr(torch.backends, "fp32_precision"):
    torch.backends.fp32_precision = "tf32"
else:
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True

model_lock = Lock()
model, tag_list = load_model("models/jtp-3-hydra.safetensors", device=device)
model.requires_grad_(False)

def rewrite_tag(tag: str) -> str:
    return tag.replace("_", " ").replace("vulva", "pussy")

tags = {
    rewrite_tag(tag): idx
    for idx, tag in enumerate(tag_list)
}
tag_list = list(tags.keys())

FONT = ImageFont.load_default(24)

@torch.no_grad()
def run_classifier(image: Image.Image, cam_depth: int):
    patches, patch_coords, patch_valid = patchify_image(image, PATCH_SIZE, MAX_SEQ_LEN)
    patches = patches.unsqueeze(0).to(device=device, non_blocking=True)
    patch_coords = patch_coords.unsqueeze(0).to(device=device, non_blocking=True)
    patch_valid = patch_valid.unsqueeze(0).to(device=device, non_blocking=True)

    patches = patches.to(dtype=torch.bfloat16).div_(127.5).sub_(1.0)
    patch_coords = patch_coords.to(dtype=torch.int32)

    with model_lock:
        features = model.forward_intermediates(
            patches,
            patch_coord=patch_coords,
            patch_valid=patch_valid,
            indices=cam_depth,
            output_dict=True,
            output_fmt='NLC'
        )

        logits = model.forward_head(features["image_features"], patch_valid=patch_valid)
        del features["image_features"]

    features["patch_coords"] = patch_coords
    features["patch_valid"] = patch_valid
    del patches, patch_coords, patch_valid

    probits = sigmoid(logits[0].to(dtype=torch.float32))
    probits.mul_(2.0).sub_(1.0) # scale to -1 to 1

    values, indices = probits.cpu().topk(250)
    predictions = {
        tag_list[idx.item()]: val.item()
        for idx, val in sorted(
            zip(indices, values),
            key=lambda item: item[1].item(),
            reverse=True
        )
    }

    return features, predictions

@torch.no_grad()
def run_cam(
    display_image: Image.Image,
    image: Image.Image, features: dict[str, Tensor],
    tag_idx: int, cam_depth: int
):
    intermediates = features["image_intermediates"]
    if len(intermediates) < cam_depth:
        features, _ = run_classifier(image, cam_depth)
        intermediates = features["image_intermediates"]
    elif len(intermediates) > cam_depth:
        intermediates = intermediates[-cam_depth:]

    patch_coords = features["patch_coords"]
    patch_valid = features["patch_valid"]

    with model_lock:
        saved_q = model.attn_pool.q
        saved_p = model.attn_pool.out_proj.weight

        try:
            model.attn_pool.q = Parameter(saved_q[:, [tag_idx], :], requires_grad=False)
            model.attn_pool.out_proj.weight = Parameter(saved_p[[tag_idx], :, :], requires_grad=False)

            with torch.enable_grad():
                for intermediate in intermediates:
                    intermediate.requires_grad_(True).retain_grad()
                    model.forward_head(intermediate, patch_valid=patch_valid)[0, 0].backward()
        finally:
            model.attn_pool.q = saved_q
            model.attn_pool.out_proj.weight = saved_p

    cam_1d: Tensor | None = None
    for intermediate in intermediates:
        patch_grad = (intermediate.grad.float() * intermediate.sign()).sum(dim=(0, 2))
        intermediate.grad = None

        if cam_1d is None:
            cam_1d = patch_grad
        else:
            cam_1d.add_(patch_grad)

    assert cam_1d is not None

    cam_2d = unpatchify(cam_1d, patch_coords, patch_valid).cpu().numpy()
    return cam_composite(display_image, cam_2d), features

def cam_composite(image: Image.Image, cam: np.ndarray):
    """
    Overlays CAM on image and returns a PIL image.
    Args:
        image_pil: PIL Image (RGB)
        cam: 2D numpy array (activation map)

    Returns:
        PIL.Image.Image with overlay
    """

    cam_abs = np.abs(cam)
    cam_scale = cam_abs.max()

    cam_rgba = np.dstack((
        (cam < 0).astype(np.float32),
        (cam > 0).astype(np.float32),
        np.zeros_like(cam, dtype=np.float32),
        cam_abs * (0.5 / cam_scale),
    ))  # Shape: (H, W, 4)

    cam_pil = Image.fromarray((cam_rgba * 255).astype(np.uint8))
    cam_pil = cam_pil.resize(image.size, resample=Image.Resampling.NEAREST)

    image = Image.blend(
        image.convert('RGBA'),
        image.convert('L').convert('RGBA'),
        0.33
    )

    image = Image.alpha_composite(image, cam_pil)

    draw = ImageDraw.Draw(image)
    draw.text(
        (image.width - 7, image.height - 7),
        f"{cam_scale.item():.4g}",
        anchor="rd", font=FONT, fill=(32, 32, 255, 255)
    )

    return image

def apply_filters(
    predictions: dict[str, float],
    threshold: float,
    calibration: dict[str, float] | None,
    blacklist_tags: set[str],
) -> dict[str, float]:
    """Apply threshold filtering and blacklist removal only.

    This returns the dict used for confidence display; append tags are
    handled separately so they do not appear with synthetic confidences.
    """
    if calibration is None:
        return {
            key: value
            for key, value in predictions.items()
            if value >= threshold and key not in blacklist_tags
        }

    return {
        key: value
        for key, value in predictions.items()
        if value >= calibration.get(key, float("inf")) and key not in blacklist_tags
    }

def filter_tags(
    predictions: dict[str, float],
    threshold: float,
    calibration: dict[str, float] | None,
    append_tags: str = "",
    blacklist_tags: str = ""
):
    """Filter tags, apply threshold/blacklist, and handle append tags.

    Returns:
        tag_str: comma-separated list including appended tags.
        predictions: dict used for confidence display (no synthetic values).
    """
    append_list = [tag.strip() for tag in append_tags.split(',') if tag.strip()]
    blacklist_set = {tag.strip() for tag in blacklist_tags.split(',') if tag.strip()}
    
    filtered_predictions = apply_filters(
        predictions, threshold, calibration, blacklist_set
    )

    tag_order: list[str] = []
    for tag in append_list:
        if tag and tag not in filtered_predictions:
            tag_order.append(tag)
    tag_order.extend(filtered_predictions.keys())

    tag_str = ", ".join(tag_order)
    return tag_str, filtered_predictions


class E6PredictRequest(BaseModel):
    image: str
    confidence: float = 0.25


class E6PredictResponse(BaseModel):
    data: list[str]


fastapi_app = FastAPI()


@fastapi_app.get("/api/e6/health")
async def e6_health():
    return {"status": "ok"}


@fastapi_app.post("/api/e6/predict", response_model=E6PredictResponse)
async def e6_predict(payload: E6PredictRequest):
    """
    Lightweight HTTP API for external clients (e.g. Tampermonkey script).

    Expects a base64 data URL or raw base64 image string and a confidence
    threshold. Returns a single-element `data` list containing the
    comma-separated tag string, matching the legacy E6AutoTagger format.
    """
    image_data = payload.image.strip()
    try:
        if "," in image_data:
            _, image_data = image_data.split(",", 1)

        image_bytes = base64.b64decode(image_data)
        image = Image.open(BytesIO(image_bytes))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Invalid image data") from exc

    processed_image = process_image(image, PATCH_SIZE, MAX_SEQ_LEN)
    _, predictions = run_classifier(processed_image, cam_depth=1)

    tag_str, _ = filter_tags(
        predictions,
        threshold=payload.confidence,
        calibration=None,
        append_tags="",
        blacklist_tags="",
    )

    return E6PredictResponse(data=[tag_str])


def save_tags_to_file(output_path: str, tags):
    """Save tags to a text file in comma-separated format.

    Accepts either a dict of tag -> score or a pre-built string.
    """
    if isinstance(tags, dict):
        tag_str = ", ".join(tags.keys())
    else:
        tag_str = str(tags)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(tag_str)

def batch_image_changed(
    image_name: str,
    batch_predictions: dict[str, dict[str, float]],
    tag_strings: dict[str, str],
    folder_path: str,
):
    """Update batch image preview and tag box to match selection."""
    if not image_name or not batch_predictions or not folder_path:
        return None, {}, ""

    image_path = os.path.join(folder_path, image_name)
    try:
        image = Image.open(image_path)
    except Exception:
        image = None

    return image, batch_predictions.get(image_name, {}), tag_strings.get(image_name, "")

def batch_cam_changed(
    image_name: str,
    folder_path: str,
    tag: str,
    cam_depth: int,
):
    """Generate or clear CAM overlay for the selected batch image and tag.

    - When tag == "None", returns the original image (no CAM).
    - Otherwise, recomputes CAM fresh from the original image so overlays
      don't stack.
    """
    if not image_name or not folder_path:
        return None

    image_path = os.path.join(folder_path, image_name)
    try:
        image = Image.open(image_path)
    except Exception:
        return None

    if tag == "None":
        return resize_image(image)

    display_image = resize_image(image)
    processed_image = process_image(image, PATCH_SIZE, MAX_SEQ_LEN)

    try:
        features, _ = run_classifier(processed_image, cam_depth)
    except Exception:
        return display_image

    tag_idx = tags.get(tag)
    if tag_idx is None:
        return display_image

    cam_image, _ = run_cam(display_image, processed_image, features, tag_idx, cam_depth)
    return cam_image

def process_folder_batch(
    folder_path: str,
    threshold: float,
    calibration: dict[str, float] | None,
    append_tags: str,
    blacklist_tags: str,
    output_dir: str,
    cam_depth: int,
    progress=gr.Progress()
):
    """Batch process images and return a per-image foldout summary.

    This does not rely on append tags having fake confidences.
    """
    output_dir = (output_dir or "").strip() or folder_path

    image_extensions = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'}
    try:
        all_files = os.listdir(folder_path)
    except Exception as e:
        return f"Error reading folder: {str(e)}", ""

    image_files = [
        f for f in all_files
        if os.path.splitext(f)[1].lower() in image_extensions
    ]

    if not image_files:
        return "No image files found in the selected folder.", ""

    os.makedirs(output_dir, exist_ok=True)

    results: list[str] = []
    batch_mapping: dict[str, dict[str, float]] = {}
    tag_strings: dict[str, str] = {}
    total_tags = 0

    for idx, image_file in enumerate(image_files):
        progress((idx + 1, len(image_files)), desc=f"Processing {image_file}")

        try:
            image_path = os.path.join(folder_path, image_file)
            image = Image.open(image_path)
            processed_image = process_image(image, PATCH_SIZE, MAX_SEQ_LEN)
            _, predictions = run_classifier(processed_image, cam_depth)

            tag_str, filtered_predictions = filter_tags(
                predictions, threshold, calibration, append_tags, blacklist_tags
            )

            output_filename = os.path.splitext(image_file)[0] + '.txt'
            output_path = os.path.join(output_dir, output_filename)
            save_tags_to_file(output_path, tag_str)

            tag_count = len([t for t in (tag_str.split(",") if tag_str else []) if t.strip()])
            tag_count = len([t for t in (tag_str.split(",") if tag_str else []) if t.strip()])
            total_tags += tag_count
            batch_mapping[image_file] = filtered_predictions
            tag_strings[image_file] = tag_str

            results.append(f"{image_file}: {tag_count} tags")

            if processed_image is not image:
                image.close()

        except Exception as e:
            results.append(f"{image_file}: Error - {str(e)}")

    summary = (
        f"Completed! Processed {len(image_files)} images.\n"
        f"Total tags generated: {total_tags}\n"
        f"Output directory: {output_dir}"
    )

    results_text = "\n".join(results)

    first_image = image_files[0] if image_files else None
    dropdown_update = gr.Dropdown(choices=image_files, value=first_image)
    first_predictions = batch_mapping.get(first_image, {}) if first_image else {}
    first_tag_string = tag_strings.get(first_image, "") if first_image else ""

    first_image_obj = None
    if first_image:
        first_path = os.path.join(folder_path, first_image)
        try:
            first_image_obj = Image.open(first_path)
        except Exception:
            first_image_obj = None

    return (
        summary,
        results_text,
        batch_mapping,
        tag_strings,
        dropdown_update,
        folder_path,
        first_image_obj,
        first_predictions,
        first_tag_string,
    )

def process_folder(
    folder_path: str,
    threshold: float,
    calibration: dict[str, float] | None,
    append_tags: str,
    blacklist_tags: str,
    output_dir: str,
    cam_depth: int,
    progress=gr.Progress()
):
    """Process all images in a folder and generate text files with tags."""
    append_list = [tag.strip() for tag in append_tags.split(',') if tag.strip()]
    blacklist_set = {tag.strip() for tag in blacklist_tags.split(',') if tag.strip()}
    
    image_extensions = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'}
    try:
        all_files = os.listdir(folder_path)
    except Exception as e:
        return f"Error reading folder: {str(e)}", ""
    
    image_files = [
        f for f in all_files
        if os.path.splitext(f)[1].lower() in image_extensions
    ]
    
    if not image_files:
        return "No image files found in the selected folder.", ""
    
    os.makedirs(output_dir, exist_ok=True)
    
    results = []
    total_tags = 0
    
    for idx, image_file in enumerate(image_files):
        progress((idx, len(image_files)), desc=f"Processing {image_file}")
        
        try:
            image_path = os.path.join(folder_path, image_file)
            image = Image.open(image_path)
            processed_image = process_image(image, PATCH_SIZE, MAX_SEQ_LEN)
            
            features, predictions = run_classifier(processed_image, cam_depth)
            
            modified_predictions = apply_tag_modifications(
                predictions, threshold, calibration, append_list, blacklist_set
            )
            
            output_filename = os.path.splitext(image_file)[0] + '.txt'
            output_path = os.path.join(output_dir, output_filename)
            save_tags_to_file(output_path, modified_predictions)
            
            tag_count = len(modified_predictions)
            total_tags += tag_count
            results.append(f"✓ {image_file}: {tag_count} tags")
            
            if processed_image is not image:
                image.close()
            
        except Exception as e:
            results.append(f"✗ {image_file}: Error - {str(e)}")
    
    summary = (
        f"Completed! Processed {len(image_files)} images.\n"
        f"Total tags generated: {total_tags}\n"
        f"Output directory: {output_dir}"
    )
    
    results_text = "\n".join(results)
    
    return summary, results_text

def resize_image(image: Image.Image) -> Image.Image:
    longest_side = max(image.height, image.width)
    if longest_side < 1080:
        return image

    scale = 1080 / longest_side
    return image.resize(
        (
            int(round(image.width * scale)),
            int(round(image.height * scale)),
        ),
        resample=Image.Resampling.LANCZOS,
        reducing_gap=3.0
    )

def image_upload(image: Image.Image):
    display_image = resize_image(image)
    processed_image = process_image(image, PATCH_SIZE, MAX_SEQ_LEN)

    if display_image is not image and processed_image is not image:
        image.close()

    return (
        "", {}, "None", "",
        gr.skip() if display_image is image else display_image, display_image,
        processed_image,
    )

def url_submit(url: str):
    resp = requests.get(url, timeout=10)
    resp.raise_for_status()

    image = Image.open(BytesIO(resp.content))
    display_image = resize_image(image)
    processed_image = process_image(image, PATCH_SIZE, MAX_SEQ_LEN)

    if display_image is not image and processed_image is not image:
        image.close()

    return (
        "", {}, "None",
        display_image, display_image,
        processed_image,
    )

def image_changed(image: Image.Image, threshold: float, calibration: dict[str, float] | None, cam_depth: int, append_tags: str = "", blacklist_tags: str = ""):
    features, predictions = run_classifier(image, cam_depth)
    return *filter_tags(predictions, threshold, calibration, append_tags, blacklist_tags), features, predictions

def image_clear():
    return (
        "", {}, "None", "",
        None, None,
        None, None, {},
    )

def threshold_input(predictions: dict[str, float], threshold: float, append_tags: str = "", blacklist_tags: str = ""):
    return (
        *filter_tags(predictions, threshold, None, append_tags, blacklist_tags), None,
        gr.Slider(label="Tag Threshold", elem_classes=[]),
        gr.Textbox(label="Upload Calibration")
    )

def parse_calibration(data) -> dict[str, float]:
    return {
        rewrite_tag(row["tag"]): float(row["threshold"])
        for row in csv.DictReader(data)
    }

def calibration_load(predictions: dict[str, float], append_tags: str = "", blacklist_tags: str = ""):
    try:
        with open("calibration.csv", "r", encoding="utf-8", newline="") as csv:
            calibration = parse_calibration(csv)
    except Exception:
        return gr.skip(), gr.skip(), gr.skip(), gr.skip(), gr.Textbox(label="Invalid Calibration File")

    return (
        *filter_tags(predictions, 0.0, calibration, append_tags, blacklist_tags), calibration,
        gr.Slider(label="Using Default Calibration", elem_classes=["inactive-slider"]),
        gr.Textbox(label="Change Calibration")
    )

def calibration_changed(predictions: dict[str, float], calibration_data: bytes, append_tags: str = "", blacklist_tags: str = ""):
    try:
        calibration = parse_calibration(StringIO(calibration_data.decode("utf-8")))
    except Exception:
        return gr.skip(), gr.skip(), gr.skip(), gr.skip(), gr.Textbox(label="Invalid Calibration File")

    return (
        *filter_tags(predictions, 0.0, calibration, append_tags, blacklist_tags), calibration,
        gr.Slider(label="Using Uploaded Calibration", elem_classes=["inactive-slider"]),
        gr.Textbox(label="Change Calibration")
    )

def cam_changed(
    display_image: Image.Image,
    image: Image.Image, features: dict[str, Tensor],
    tag: str, cam_depth: int
):
    if tag == "None":
        return display_image, features

    return run_cam(display_image, image, features, tags[tag], cam_depth)

def tag_box_select(evt: gr.SelectData):
    return evt.value

custom_css = """
.output-class { display: none; }
.inferno-slider input[type=range] {
    background: linear-gradient(to right,
        #000004, #1b0c41, #4a0c6b, #781c6d,
        #a52c60, #cf4446, #ed6925, #fb9b06,
        #f7d13d, #fcffa4
    ) !important;
    background-size: 100% 100% !important;
}

.inactive-slider input[type=range] {
    --slider-color: grey !important;
}

#image_container-image {
    width: 100%;
    aspect-ratio: 1 / 1;
    max-height: 100%;
}
#image_container img {
    object-fit: contain !important;
}
.show-api, .show-api-divider {
    display: none !important;
}
"""

with gr.Blocks(
    title="RedRocket JTP-3 Hydra",
    css=custom_css,
    analytics_enabled=False,
) as demo:
    display_image_state = gr.State()
    image_state = gr.State()
    features_state = gr.State()
    predictions_state = gr.State(value={})
    calibration_state = gr.State()
    batch_predictions_state = gr.State(value={})
    batch_folder_state = gr.State(value="")
    batch_tag_strings_state = gr.State(value={})


    gr.HTML(
        "<h1 style='display:flex; flex-flow: row nowrap; align-items: center;'>"
        "<a href='https://huggingface.co/RedRocket' target='_blank'>"
        "<img src='https://huggingface.co/spaces/RedRocket/README/resolve/main/RedRocket.png' style='width: 2em; margin-right: 0.5em;'>"
        "</a>"
        "<span>"
        "<a href='https://huggingface.co/RedRocket' target='_blank'>RedRocket</a> &ndash; JTP-3 Hydra"
        "</span>"
        "</h1>"
    )

    with gr.Tabs():
        with gr.Tab("Single Image"):
            with gr.Row():
                with gr.Column():
                    with gr.Column():
                        image = gr.Image(
                            sources=['upload', 'clipboard'], type='pil',
                            show_label=False,
                            show_download_button=False,
                            show_share_button=False,
                            elem_id="image_container"
                        )

                        url = gr.Textbox(
                            label="Upload Image via Url:",
                            placeholder="https://example.com/image.jpg",
                            max_lines=1,
                            submit_btn="⮝",
                        )

                    with gr.Column():
                        cam_tag = gr.Dropdown(
                            value="None", choices=["None"] + tag_list,
                            label="CAM Attention Overlay (You can also click a tag on the right.)", show_label=True
                        )
                        cam_depth = gr.Slider(
                            minimum=1, maximum=27, step=1, value=1,
                            label="CAM Depth (1=fastest, more precise; 27=slowest, more general)"
                        )

                with gr.Column():
                    with gr.Row(variant="panel"):
                        threshold_slider = gr.Slider(
                            minimum=0.00, maximum=1.00, step=0.01, value=0.30,
                            label="Tag Threshold", scale=4
                        )

                        with gr.Column(), gr.Group():
                            calibration_default = gr.Button(
                                interactive=os.path.exists("calibration.csv"),
                                value="Default Calibration", size="lg",
                            )

                            calibration_upload = gr.UploadButton(
                                file_count="single", file_types=["text"], type="binary",
                                label="Upload Calibration", size="md", variant="secondary",
                            )

                    # Tag modification inputs
                    with gr.Row():
                        append_tags_input = gr.Textbox(
                            label="Append Tags (comma-separated)",
                            placeholder="tag1, tag2, tag3",
                            max_lines=1
                        )
                        blacklist_tags_input = gr.Textbox(
                            label="Blacklist Tags (comma-separated)",
                            placeholder="tag1, tag2, tag3",
                            max_lines=1
                        )

                    tag_string = gr.Textbox(lines=3, label="Tags", show_copy_button=True)
                    tag_box = gr.Label(num_top_classes=250, show_label=False, show_heading=False)

        with gr.Tab("Batch Processing"):
            with gr.Row():
                with gr.Column():
                    batch_folder_input = gr.Textbox(
                        label="Input Folder Path",
                        placeholder="C:\\path\\to\\images",
                        max_lines=1
                    )
                    batch_output_input = gr.Textbox(
                        label="Output Folder Path (for text files)",
                        placeholder="C:\\path\\to\\output (Defaults to Input if blank)",
                        max_lines=1
                    )
                    
                    with gr.Row():
                        batch_threshold = gr.Slider(
                            minimum=0.00, maximum=1.00, step=0.01, value=0.30,
                            label="Tag Threshold"
                        )
                        batch_cam_depth = gr.Slider(
                            minimum=1, maximum=27, step=1, value=1,
                            label="CAM Depth"
                        )
                    batch_cam_tag = gr.Dropdown(
                        value="None",
                        choices=["None"] + tag_list,
                        label="CAM Attention Overlay (You can also click a tag on the right.)",
                        show_label=True
                    )
                    
                    with gr.Row():
                        batch_append_tags = gr.Textbox(
                            label="Append Tags (comma-separated)",
                            placeholder="tag1, tag2, tag3",
                            max_lines=1
                        )
                        batch_blacklist_tags = gr.Textbox(
                            label="Blacklist Tags (comma-separated)",
                            placeholder="tag1, tag2, tag3",
                            max_lines=1
                        )
                    
                    batch_process_btn = gr.Button("Process Folder", variant="primary", size="lg")
                
                with gr.Column():
                    batch_summary = gr.Textbox(
                        label="Processing Summary",
                        lines=3,
                        interactive=False
                    )
                    batch_image_preview = gr.Image(
                        label="Batch Image",
                        type="pil",
                        interactive=False,
                        show_download_button=False,
                        show_share_button=False,
                    )
                    batch_image_dropdown = gr.Dropdown(
                        label="Select Image",
                        choices=[],
                        interactive=True
                    )
                    batch_tag_string = gr.Textbox(
                        lines=3,
                        label="Tags",
                        show_copy_button=True
                    )
                    batch_tag_box = gr.Label(
                        num_top_classes=250,
                        label="Batch Tags",
                        show_label=True,
                        show_heading=False
                    )
                    batch_results = gr.Markdown(label="Detailed Results")

    image.upload(
        fn=image_upload,
        inputs=[image],
        outputs=[
            tag_string, tag_box, cam_tag, url,
            image, display_image_state,
            image_state,
        ],
        show_progress='minimal',
        show_progress_on=[image]
    ).then(
        fn=image_changed,
        inputs=[image_state, threshold_slider, calibration_state, cam_depth, append_tags_input, blacklist_tags_input],
        outputs=[
            tag_string, tag_box,
            features_state, predictions_state,
        ],
        show_progress='minimal',
        show_progress_on=[tag_box]
    )

    url.submit(
        fn=url_submit,
        inputs=[url],
        outputs=[
            tag_string, tag_box, cam_tag,
            image, display_image_state,
            image_state,
        ],
        show_progress='minimal',
        show_progress_on=[url]
    ).then(
        fn=image_changed,
        inputs=[image_state, threshold_slider, calibration_state, cam_depth, append_tags_input, blacklist_tags_input],
        outputs=[
            tag_string, tag_box,
            features_state, predictions_state,
        ],
        show_progress='minimal',
        show_progress_on=[tag_box]
    )

    image.clear(
        fn=image_clear,
        inputs=[],
        outputs=[
            tag_string, tag_box, cam_tag, url,
            image, display_image_state,
            image_state, features_state, predictions_state,
        ],
        show_progress='hidden'
    )

    threshold_slider.input(
        fn=threshold_input,
        inputs=[predictions_state, threshold_slider, append_tags_input, blacklist_tags_input],
        outputs=[tag_string, tag_box, calibration_state, threshold_slider, calibration_upload],
        trigger_mode='always_last',
        show_progress='hidden'
    )

    calibration_default.click(
        fn=calibration_load,
        inputs=[predictions_state, append_tags_input, blacklist_tags_input],
        outputs=[tag_string, tag_box, calibration_state, threshold_slider, calibration_upload],
        show_progress='hidden'
    )

    calibration_upload.upload(
        fn=calibration_changed,
        inputs=[predictions_state, calibration_upload, append_tags_input, blacklist_tags_input],
        outputs=[tag_string, tag_box, calibration_state, threshold_slider, calibration_upload],
        trigger_mode='always_last',
        show_progress='minimal',
        show_progress_on=[calibration_upload],
    )

    cam_tag.input(
        fn=cam_changed,
        inputs=[
            display_image_state,
            image_state, features_state,
            cam_tag, cam_depth,
        ],
        outputs=[image, features_state],
        trigger_mode='always_last',
        show_progress='minimal',
        show_progress_on=[cam_tag]
    )

    cam_depth.input(
        fn=cam_changed,
        inputs=[
            display_image_state,
            image_state, features_state,
            cam_tag, cam_depth,
        ],
        outputs=[image, features_state],
        trigger_mode='always_last',
        show_progress='minimal',
        show_progress_on=[cam_depth]
    )

    tag_box.select(
        fn=tag_box_select,
        inputs=[],
        outputs=[cam_tag],
        trigger_mode='always_last',
        show_progress='hidden',
    ).then(
        fn=cam_changed,
        inputs=[
            display_image_state,
            image_state, features_state,
            cam_tag, cam_depth,
        ],
        outputs=[image, features_state],
        show_progress='minimal',
        show_progress_on=[cam_tag]
    )

    scan_timer = gr.Timer()
    scan_timer.tick(
        fn=lambda: gr.Button(interactive=os.path.exists("calibration.csv")),
        outputs=[calibration_default],
        show_progress='hidden'
    )
    # Event handlers for append/blacklist tags
    append_tags_input.input(
    fn=threshold_input,
    inputs=[predictions_state, threshold_slider, append_tags_input, blacklist_tags_input],
    outputs=[tag_string, tag_box, calibration_state, threshold_slider, calibration_upload],
    trigger_mode='always_last',
    show_progress='hidden'
)

    blacklist_tags_input.input(
    fn=threshold_input,
    inputs=[predictions_state, threshold_slider, append_tags_input, blacklist_tags_input],
    outputs=[tag_string, tag_box, calibration_state, threshold_slider, calibration_upload],
    trigger_mode='always_last',
    show_progress='hidden'
)

    # Batch processing event handler
    batch_process_btn.click(
        fn=process_folder_batch,
        inputs=[
            batch_folder_input,
            batch_threshold,
            calibration_state,
            batch_append_tags,
            batch_blacklist_tags,
            batch_output_input,
            batch_cam_depth
        ],
        outputs=[
            batch_summary,
            batch_results,
            batch_predictions_state,
            batch_tag_strings_state,
            batch_image_dropdown,
            batch_folder_state,
            batch_image_preview,
            batch_tag_box,
            batch_tag_string,
        ],
        show_progress='full'
    )

    batch_image_dropdown.input(
        fn=batch_image_changed,
        inputs=[batch_image_dropdown, batch_predictions_state, batch_tag_strings_state, batch_folder_state],
        outputs=[batch_image_preview, batch_tag_box, batch_tag_string],
        trigger_mode='always_last',
        show_progress='hidden'
    )

    batch_tag_box.select(
        fn=tag_box_select,
        inputs=[],
        outputs=[batch_cam_tag],
        trigger_mode='always_last',
        show_progress='hidden',
    ).then(
        fn=batch_cam_changed,
        inputs=[batch_image_dropdown, batch_folder_state, batch_cam_tag, batch_cam_depth],
        outputs=[batch_image_preview],
        show_progress='minimal',
        show_progress_on=[batch_cam_tag],
    )

    batch_cam_tag.input(
        fn=batch_cam_changed,
        inputs=[batch_image_dropdown, batch_folder_state, batch_cam_tag, batch_cam_depth],
        outputs=[batch_image_preview],
        trigger_mode='always_last',
        show_progress='minimal'
    )


if __name__ == "__main__":
    import uvicorn

    app = gr.mount_gradio_app(fastapi_app, demo, path="/")
    uvicorn.run(app, host="127.0.0.1", port=7860)
