from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import cv2


ROOT = Path(__file__).resolve().parent
MODEL_DIR = ROOT / "models"
MODEL_DIR.mkdir(exist_ok=True)

DEFAULT_MODEL_NAME = os.environ.get("YOLO_MODEL", "yolo11n.pt")
DEFAULT_MODEL_PATH = MODEL_DIR / DEFAULT_MODEL_NAME
ROOT_MODEL_PATH = ROOT / DEFAULT_MODEL_NAME


def analyze_video(input_path: str | Path, options: dict | None = None) -> dict:
    options = options or {}
    sample_rate = max(0.1, float(options.get("sampleRate", 0.35)))
    confidence = min(0.95, max(0.05, float(options.get("confidence", 0.25))))
    max_people = max(1, min(12, int(options.get("maxPeople", 8))))
    tracker_name = str(options.get("tracker", "bytetrack.yaml"))

    cap = cv2.VideoCapture(str(input_path))
    if not cap.isOpened():
        raise RuntimeError("无法打开待分析视频")

    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    duration = frame_count / fps if fps > 0 and frame_count > 0 else 0.0
    if duration <= 0:
        duration = max(0.0, float(options.get("duration", 0.0)))

    model = get_model()
    frames = []
    process_interval = tracking_interval(sample_rate)
    frame_stride = compute_frame_stride(fps, process_interval)
    model.predictor = None
    synthetic_id = 1

    try:
        frame_index = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if frame is None:
                break
            if frame_index % frame_stride != 0:
                frame_index += 1
                continue

            time_point = frame_index / fps if fps > 0 else len(frames) * process_interval
            result = model.track(
                source=frame,
                classes=[0],
                conf=confidence,
                iou=0.55,
                verbose=False,
                device="cpu",
                max_det=max_people,
                persist=True,
                tracker=tracker_name,
            )[0]
            boxes = []
            xyxy = result.boxes.xyxy.cpu().tolist() if result.boxes is not None else []
            scores = result.boxes.conf.cpu().tolist() if result.boxes is not None else []
            track_ids = result.boxes.id.int().cpu().tolist() if result.boxes is not None and result.boxes.id is not None else []
            for idx, (coords, score) in enumerate(zip(xyxy, scores)):
                x1, y1, x2, y2 = coords
                w = max(1.0, x2 - x1)
                h = max(1.0, y2 - y1)
                track_id = track_ids[idx] if idx < len(track_ids) else synthetic_id
                synthetic_id = max(synthetic_id, int(track_id) + 1)
                boxes.append({
                    "trackId": f"T{int(track_id)}",
                    "x": round(float(x1), 2),
                    "y": round(float(y1), 2),
                    "w": round(float(w), 2),
                    "h": round(float(h), 2),
                    "score": round(float(score), 4),
                })
            frames.append({
                "time": round(float(time_point), 3),
                "boxes": boxes,
            })
            frame_index += 1
    finally:
        model.predictor = None
        cap.release()

    return {
        "frames": frames,
        "metadata": {
            "width": width,
            "height": height,
            "duration": round(duration, 3),
            "sample_rate": sample_rate,
            "tracking_interval": process_interval,
            "fps": fps,
        },
        "model": model_name(),
        "tracker": tracker_name,
    }


def get_runtime_info() -> dict:
    try:
        model = get_model()
        return {
            "ready": True,
            "model_name": model_name(),
            "detail": f"{type(model).__name__} ready",
        }
    except Exception as exc:  # pragma: no cover - UI fallback path
        return {
            "ready": False,
            "model_name": model_name(),
            "detail": str(exc),
        }


@lru_cache(maxsize=1)
def get_model():
    from ultralytics import YOLO

    source = resolve_model_source()
    return YOLO(source)


def resolve_model_source() -> str:
    if DEFAULT_MODEL_PATH.exists():
        return str(DEFAULT_MODEL_PATH)
    if ROOT_MODEL_PATH.exists():
        return str(ROOT_MODEL_PATH)
    return DEFAULT_MODEL_NAME


def model_name() -> str:
    return Path(resolve_model_source()).name


def build_timeline(duration: float, sample_rate: float) -> list[float]:
    if duration <= 0:
        return [0.0]
    timeline = []
    current = 0.0
    while current < duration:
        timeline.append(round(current, 3))
        current += sample_rate
    if not timeline or abs(timeline[-1] - duration) > 0.08:
        timeline.append(round(duration, 3))
    return timeline


def tracking_interval(sample_rate: float) -> float:
    return min(max(0.08, sample_rate / 2), 0.16)


def compute_frame_stride(fps: float, interval: float) -> int:
    if fps <= 0:
        return 1
    return max(1, int(round(fps * interval)))
