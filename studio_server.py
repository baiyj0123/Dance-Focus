from __future__ import annotations

import json
import tempfile
import traceback
import urllib.parse
from email.parser import BytesParser
from email.policy import default
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from renderer import render_project
from yolo_backend import analyze_video, get_runtime_info


ROOT = Path(__file__).resolve().parent
RENDER_DIR = ROOT / "rendered"
RENDER_DIR.mkdir(exist_ok=True)


class StudioHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/health":
            runtime = get_runtime_info()
            return self.respond_json({
                "ok": True,
                "render_dir": str(RENDER_DIR),
                "yolo_ready": runtime["ready"],
                "yolo_model": runtime["model_name"],
                "yolo_detail": runtime["detail"],
            })
        return super().do_GET()

    def do_POST(self):
        if self.path not in {"/api/render", "/api/analyze"}:
            self.send_error(404, "Not Found")
            return
        try:
            fields = self.parse_multipart()
            video_part = fields.get("video")
            if not video_part:
                raise RuntimeError("请求缺少 video 字段")
            filename = sanitize_filename(video_part.get("filename") or "source.mp4")

            with tempfile.TemporaryDirectory(prefix="dance_privacy_") as tmpdir:
                source_path = Path(tmpdir) / filename
                source_path.write_bytes(video_part["content"])
                if self.path == "/api/analyze":
                    options_part = fields.get("options")
                    options = {}
                    if options_part:
                        options = json.loads(options_part["content"].decode("utf-8"))
                    result = analyze_video(source_path, options)
                    return self.respond_json({"ok": True, **result})

                project_part = fields.get("project")
                if not project_part:
                    raise RuntimeError("请求缺少 project 字段")
                project = json.loads(project_part["content"].decode("utf-8"))
                output_name = f"{Path(filename).stem}-single-performer.mp4"
                output_path = RENDER_DIR / output_name
                result = render_project(source_path, project, output_path)
                return self.respond_json({
                    "ok": True,
                    "download_url": f"/rendered/{urllib.parse.quote(output_name)}",
                    "size_label": result["size_label"],
                })
        except Exception as exc:
            traceback.print_exc()
            self.send_response(500)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(str(exc).encode("utf-8"))

    def parse_multipart(self):
        content_type = self.headers.get("Content-Type", "")
        content_length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(content_length)
        raw = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8") + body
        message = BytesParser(policy=default).parsebytes(raw)
        fields = {}
        for part in message.iter_parts():
            name = part.get_param("name", header="content-disposition")
            if not name:
                continue
            fields[name] = {
                "filename": part.get_filename(),
                "content": part.get_payload(decode=True),
                "content_type": part.get_content_type(),
            }
        return fields

    def respond_json(self, payload: dict):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def sanitize_filename(name: str) -> str:
    safe = name.replace("/", "_").replace("\\", "_").strip()
    return safe or "source.mp4"


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 4818), StudioHandler)
    print("Studio server running at http://127.0.0.1:4818")
    server.serve_forever()


if __name__ == "__main__":
    main()
