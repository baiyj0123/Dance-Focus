from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import cv2
import numpy as np


FFMPEG = os.environ.get("FFMPEG_BIN", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE_BIN", "ffprobe")
EXPORT_CRF = os.environ.get("EXPORT_CRF", "12")
EXPORT_PRESET = os.environ.get("EXPORT_PRESET", "veryslow")


def render_project(input_path: str | Path, project: dict, output_path: str | Path) -> dict:
    input_path = Path(input_path)
    output_path = Path(output_path)
    meta = probe_video(input_path)
    source_width = int(meta["width"])
    source_height = int(meta["height"])
    start = float(project["trim"]["start"])
    end = float(project["trim"]["end"])
    fps = int(project["fps"])
    output_width = int(project["output"]["width"])
    output_height = int(project["output"]["height"])

    decode_cmd = [
        FFMPEG,
        "-v",
        "error",
        "-i",
        str(input_path),
        "-ss",
        f"{start:.3f}",
        "-to",
        f"{end:.3f}",
        "-vf",
        f"fps={fps}",
        "-an",
        "-sn",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
    ]
    encode_cmd = [
        FFMPEG,
        "-y",
        "-v",
        "error",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s:v",
        f"{output_width}x{output_height}",
        "-r",
        str(fps),
        "-i",
        "pipe:0",
        "-ss",
        f"{start:.3f}",
        "-to",
        f"{end:.3f}",
        "-i",
        str(input_path),
        "-map",
        "0:v:0",
        "-map",
        "1:a?",
        "-c:v",
        "libx264",
        "-preset",
        EXPORT_PRESET,
        "-crf",
        EXPORT_CRF,
        "-profile:v",
        "high",
        "-coder",
        "1",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        str(output_path),
    ]

    decode = subprocess.Popen(decode_cmd, stdout=subprocess.PIPE)
    encode = subprocess.Popen(encode_cmd, stdin=subprocess.PIPE)

    frame_bytes = source_width * source_height * 3
    previous_crop = None
    frame_index = 0
    try:
      while True:
        chunk = decode.stdout.read(frame_bytes)
        if len(chunk) < frame_bytes:
          break
        time = start + frame_index / fps
        frame = np.frombuffer(chunk, dtype=np.uint8).reshape((source_height, source_width, 3)).copy()
        rendered, previous_crop = render_frame(frame, project, time, previous_crop, source_width, source_height)
        encode.stdin.write(rendered.tobytes())
        frame_index += 1
    finally:
      if decode.stdout:
        decode.stdout.close()
      if encode.stdin:
        encode.stdin.close()
      decode.wait()
      encode.wait()

    if decode.returncode != 0:
      raise RuntimeError("FFmpeg 解码失败")
    if encode.returncode != 0:
      raise RuntimeError("FFmpeg 编码失败")

    size_mb = output_path.stat().st_size / (1024 * 1024)
    return {
        "output_path": str(output_path),
        "size_label": f"{size_mb:.1f} MB",
    }


def probe_video(input_path: Path) -> dict:
    cmd = [
        FFPROBE,
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "json",
        str(input_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    payload = json.loads(result.stdout)
    stream = payload["streams"][0]
    return {
        "width": int(stream["width"]),
        "height": int(stream["height"]),
    }


def render_frame(frame: np.ndarray, project: dict, time: float, previous_crop: dict | None, source_width: int, source_height: int):
    boxes = get_boxes_at_time(project["tracks"], time)
    active_track_id = get_active_track_id(project.get("heroAssignments", []), project.get("selectedTrackId"), time)
    selected_box = next((item["box"] for item in boxes if item["trackId"] == active_track_id), None)
    if selected_box is None and boxes:
        active_track_id = boxes[0]["trackId"]
        selected_box = boxes[0]["box"]

    keep_ids = {active_track_id} if active_track_id else set()
    redactions = [expand_box(item["box"], float(project["safetyMargin"]), source_width, source_height) for item in boxes if item["trackId"] not in keep_ids]
    output_width = int(project["output"]["width"])
    output_height = int(project["output"]["height"])

    if project["mode"] == "privacy" or selected_box is None:
        working = frame.copy()
        for box in redactions:
            apply_redaction(working, box, project["redactionStyle"])
        return resize_bilinear(working, output_height, output_width), previous_crop

    crop = make_portrait_crop(selected_box, output_width, output_height, source_width, source_height, float(project["cropPadding"]))
    if previous_crop is not None:
        crop = smooth_crop(previous_crop, crop, float(project["smoothing"]))
    crop = normalize_crop(crop, source_width, source_height)
    crop_frame = frame[crop["y"]: crop["y"] + crop["h"], crop["x"]: crop["x"] + crop["w"]].copy()

    for box in redactions:
        clipped = intersect_box(box, crop)
        if clipped is None:
            continue
        mapped = {
            "x": clipped["x"] - crop["x"],
            "y": clipped["y"] - crop["y"],
            "w": clipped["w"],
            "h": clipped["h"],
        }
        apply_redaction(crop_frame, mapped, project["redactionStyle"])

    return resize_bilinear(crop_frame, output_height, output_width), crop


def get_boxes_at_time(tracks: list[dict], time: float) -> list[dict]:
    response = []
    for track in tracks:
        box = interpolate_track_box(track["samples"], time)
        if box is not None:
            response.append({"trackId": track["id"], "box": box})
    return response


def interpolate_track_box(samples: list[dict], time: float):
    if not samples:
        return None
    before = None
    after = None
    for sample in samples:
        if sample["time"] <= time:
            before = sample
        if sample["time"] >= time:
            after = sample
            break
    before = before or samples[0]
    after = after or samples[-1]
    if abs(before["time"] - time) > 1.25 and abs(after["time"] - time) > 1.25:
        return None
    if before["time"] == after["time"]:
        return normalize_box(before["box"])
    ratio = (time - before["time"]) / max(after["time"] - before["time"], 1e-6)
    return {
        "x": lerp(before["box"]["x"], after["box"]["x"], ratio),
        "y": lerp(before["box"]["y"], after["box"]["y"], ratio),
        "w": lerp(before["box"]["w"], after["box"]["w"], ratio),
        "h": lerp(before["box"]["h"], after["box"]["h"], ratio),
    }


def get_active_track_id(assignments: list[dict], selected_track_id: str | None, time: float):
    if not assignments:
        return selected_track_id
    active = assignments[0]["trackId"]
    for item in assignments:
        if item["time"] <= time:
            active = item["trackId"]
        else:
            break
    return active


def expand_box(box: dict, margin_ratio: float, source_width: int, source_height: int) -> dict:
    mx = box["w"] * margin_ratio
    my = box["h"] * margin_ratio
    x = clamp(box["x"] - mx, 0, source_width)
    y = clamp(box["y"] - my, 0, source_height)
    return {
        "x": x,
        "y": y,
        "w": clamp(box["w"] + mx * 2, 1, source_width - x),
        "h": clamp(box["h"] + my * 2, 1, source_height - y),
    }


def make_portrait_crop(box: dict, output_width: int, output_height: int, source_width: int, source_height: int, padding: float) -> dict:
    aspect = output_width / output_height
    target_h = clamp(box["h"] * (1 + padding * 1.2), source_height * 0.3, source_height)
    target_w = min(target_h * aspect, source_width)
    center_x = box["x"] + box["w"] / 2
    center_y = box["y"] + box["h"] / 2 - box["h"] * 0.1
    x = clamp(center_x - target_w / 2, 0, max(0, source_width - target_w))
    y = clamp(center_y - target_h / 2, 0, max(0, source_height - target_h))
    return {"x": x, "y": y, "w": target_w, "h": target_h}


def smooth_crop(previous: dict, current: dict, amount: float) -> dict:
    return {
        "x": lerp(current["x"], previous["x"], amount),
        "y": lerp(current["y"], previous["y"], amount),
        "w": lerp(current["w"], previous["w"], amount),
        "h": lerp(current["h"], previous["h"], amount),
    }


def normalize_crop(crop: dict, source_width: int, source_height: int) -> dict:
    x = max(0, min(int(round(crop["x"])), source_width - 1))
    y = max(0, min(int(round(crop["y"])), source_height - 1))
    w = max(2, min(int(round(crop["w"])), source_width - x))
    h = max(2, min(int(round(crop["h"])), source_height - y))
    return {"x": x, "y": y, "w": w, "h": h}


def intersect_box(a: dict, b: dict):
    x1 = max(a["x"], b["x"])
    y1 = max(a["y"], b["y"])
    x2 = min(a["x"] + a["w"], b["x"] + b["w"])
    y2 = min(a["y"] + a["h"], b["y"] + b["h"])
    if x2 <= x1 or y2 <= y1:
        return None
    return {"x": int(x1), "y": int(y1), "w": int(x2 - x1), "h": int(y2 - y1)}


def apply_redaction(frame: np.ndarray, box: dict, style: str):
    x = int(max(0, round(box["x"])))
    y = int(max(0, round(box["y"])))
    w = int(max(1, round(box["w"])))
    h = int(max(1, round(box["h"])))
    region = frame[y:y + h, x:x + w]
    if region.size == 0:
        return
    if style == "solid":
        region[:] = np.array([18, 24, 34], dtype=np.uint8)
        return
    if style == "blur":
        frame[y:y + h, x:x + w] = blur_region(region)
        return
    frame[y:y + h, x:x + w] = mosaic_region(region)


def mosaic_region(region: np.ndarray) -> np.ndarray:
    h, w = region.shape[:2]
    cell = max(8, min(h, w) // 10)
    down = resize_nearest(region, max(2, h // cell), max(2, w // cell))
    return resize_nearest(down, h, w)


def blur_region(region: np.ndarray) -> np.ndarray:
    blur = max(3, ((min(region.shape[:2]) // 14) * 2) + 1)
    return cv2.GaussianBlur(region, (blur, blur), 0)


def resize_nearest(image: np.ndarray, out_h: int, out_w: int) -> np.ndarray:
    if image.shape[0] == out_h and image.shape[1] == out_w:
        return image.copy()
    y_idx = np.clip(np.round(np.linspace(0, image.shape[0] - 1, out_h)).astype(int), 0, image.shape[0] - 1)
    x_idx = np.clip(np.round(np.linspace(0, image.shape[1] - 1, out_w)).astype(int), 0, image.shape[1] - 1)
    return image[y_idx][:, x_idx]


def resize_bilinear(image: np.ndarray, out_h: int, out_w: int) -> np.ndarray:
    src_h, src_w = image.shape[:2]
    if src_h == out_h and src_w == out_w:
        return image.copy()
    return cv2.resize(image, (out_w, out_h), interpolation=cv2.INTER_LANCZOS4)


def normalize_box(box: dict) -> dict:
    return {
        "x": float(box["x"]),
        "y": float(box["y"]),
        "w": float(box["w"]),
        "h": float(box["h"]),
    }


def clamp(value: float, min_value: float, max_value: float) -> float:
    return min(max_value, max(min_value, value))


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t
