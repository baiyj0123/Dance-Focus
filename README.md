# Dance-Focus

Dance-Focus 是一个面向舞蹈视频的本地化 AI 处理工作台，用于从多人舞蹈素材中生成单人直拍，并对非目标人物进行隐私遮挡。项目在本机浏览器中操作，视频分析与导出由本地 Python 服务完成，适合舞蹈翻跳、课堂练习、排练记录、社媒二创素材整理等场景。

## 核心能力

- 本地上传舞蹈视频素材，无需账号或云端服务
- 基于 `Ultralytics YOLO11n` 自动识别视频中的人物
- 使用 `ByteTrack` 对人物进行跨帧跟踪，生成人物轨迹列表
- 支持选择主舞者，并通过关键帧在不同时刻切换主角
- 支持两种处理模式：
  - `单人直拍`：从横屏素材中裁出主舞者 9:16 画面
  - `全画面打码`：保留原画面构图，对非保留人物做遮挡
- 支持马赛克、模糊、纯色遮挡三种隐私处理方式
- 支持入点、出点、裁切留白、安全边距、镜头平滑、导出帧率等参数
- 支持 `原视频高度 9:16` 与 `原视频分辨率` 两类高规格输出
- 使用本地 `Python + NumPy + FFmpeg` 逐帧渲染，导出 `MP4(H.264 + AAC)`
- 本地服务不可用时，前端可回退到浏览器导出链路
- 在浏览器本地保存最近导出历史

## 技术架构

项目由一个静态前端和一个本地 Python 服务组成。

```text
Browser UI
  |
  | 上传视频 / 参数 / 主角轨迹
  v
Python Local Server (127.0.0.1:4818)
  |
  |-- /api/analyze  -> YOLO11n + ByteTrack 人物检测与跟踪
  |
  |-- /api/render   -> OpenCV + NumPy + FFmpeg 逐帧渲染导出
```

主要模块：

- `index.html`：工作台页面结构
- `styles.css`：界面样式
- `app.js`：前端交互、视频预览、参数管理、接口调用
- `studio_server.py`：本地 HTTP 服务，提供静态文件、分析接口和导出接口
- `yolo_backend.py`：YOLO 模型加载、人物检测、ByteTrack 跟踪、碎轨合并
- `renderer.py`：裁切、遮挡、平滑、逐帧渲染与 FFmpeg 编码
- `models/`：本地模型目录，默认使用 `yolo11n.pt`
- `rendered/`：导出视频目录

## 技术栈

- 前端：原生 `HTML / CSS / JavaScript`
- 本地服务：Python 标准库 `http.server`
- 人物检测：`ultralytics` / `YOLO11n`
- 目标跟踪：`ByteTrack`
- 视频读取与图像处理：`opencv-python-headless`
- 数值与像素处理：`numpy`
- 视频解码、编码与音频保留：`FFmpeg / FFprobe`
- 导出格式：`MP4(H.264 + AAC)`

## 环境要求

推荐环境：

- Python `3.11` 或 `3.12`
- FFmpeg `6.x` 或更高版本
- macOS、Windows 或 Linux
- 运行时需要浏览器访问 `http://127.0.0.1:4818`

不建议使用 Python 预览版或过新的 alpha/beta 版本，例如 `3.15.0a`，因为 OpenCV、Ultralytics 等依赖可能尚未提供兼容包。

## 快速启动

### macOS

安装 FFmpeg：

```bash
brew install ffmpeg
```

进入项目目录，创建虚拟环境并安装依赖：

```bash
cd Dance-Focus
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install ultralytics opencv-python-headless numpy
```

启动本地服务：

```bash
python studio_server.py
```

浏览器访问：

```text
http://127.0.0.1:4818
```

### Windows

1. 安装 Python `3.11` 或 `3.12`
2. 安装 FFmpeg，并把 `ffmpeg.exe` 和 `ffprobe.exe` 所在目录加入系统 `PATH`
3. 在项目目录打开 PowerShell 或命令提示符

创建虚拟环境并安装依赖：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install ultralytics opencv-python-headless numpy
```

启动本地服务：

```powershell
python studio_server.py
```

浏览器访问：

```text
http://127.0.0.1:4818
```

如果 PowerShell 禁止激活虚拟环境，可以改用：

```powershell
.\.venv\Scripts\python.exe studio_server.py
```

### Linux

安装 FFmpeg：

```bash
sudo apt update
sudo apt install ffmpeg python3-venv
```

创建虚拟环境并安装依赖：

```bash
cd Dance-Focus
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install ultralytics opencv-python-headless numpy
```

启动：

```bash
python studio_server.py
```

## 使用流程

1. 启动本地服务并打开 `http://127.0.0.1:4818`
2. 点击 `导入素材` 上传舞蹈视频
3. 点击 `连接 YOLO`，确认本地识别服务可用
4. 点击 `识别人物`，等待系统生成人物轨迹
5. 在轨迹列表中选择主舞者
6. 如画面中多人交叉或主角切换，可添加主角关键帧
7. 选择处理模式、遮挡样式、裁切留白、安全边距、导出帧率等参数
8. 点击导出，生成的视频会保存在 `rendered/` 目录，并在页面中提供下载入口

## 运行配置

可以通过环境变量调整模型和导出参数。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `YOLO_MODEL` | `yolo11n.pt` | 指定 YOLO 模型文件名或模型标识 |
| `FFMPEG_BIN` | `ffmpeg` | 指定 FFmpeg 可执行文件路径 |
| `FFPROBE_BIN` | `ffprobe` | 指定 FFprobe 可执行文件路径 |
| `EXPORT_CRF` | `12` | H.264 导出质量，数值越低质量越高、文件越大 |
| `EXPORT_PRESET` | `veryslow` | FFmpeg 编码预设，越慢通常压缩效率越高 |

示例：

```bash
EXPORT_CRF=16 EXPORT_PRESET=slow python studio_server.py
```

Windows PowerShell 示例：

```powershell
$env:EXPORT_CRF="16"
$env:EXPORT_PRESET="slow"
python studio_server.py
```

## 模型说明

项目默认使用 `YOLO11n` 预训练模型做人像检测。这里并没有训练新模型，而是调用已经训练好的通用人物检测模型进行推理。

- 检测类别：`person`
- 默认模型：`yolo11n.pt`
- 默认设备：CPU
- 默认跟踪器：`bytetrack.yaml`
- 首次运行时，如果本地没有模型文件，Ultralytics 可能会自动下载模型

如需使用其他 YOLO 模型，可将模型文件放入 `models/` 目录，并通过 `YOLO_MODEL` 指定。

## 输出说明

导出链路会使用 FFmpeg 解码原视频，将每一帧交给 Python 处理后，再编码为 MP4。

- 视频编码：`libx264`
- 像素格式：`yuv420p`
- 音频编码：`aac`
- 音频来源：尽量保留原视频音轨
- 输出目录：`rendered/`

导出速度取决于视频长度、分辨率、帧率、CPU 性能和编码预设。`veryslow` 质量较好，但耗时更长。

## 常见问题

### `ModuleNotFoundError: No module named 'cv2'`

说明当前 Python 环境缺少 OpenCV。请先进入虚拟环境，再安装依赖：

```bash
python -m pip install opencv-python-headless
```

### `ffmpeg` 或 `ffprobe` 找不到

说明 FFmpeg 没有安装，或可执行文件不在 `PATH` 中。

macOS：

```bash
brew install ffmpeg
```

Windows：安装 FFmpeg 后，把 `bin` 目录加入系统 `PATH`，或通过 `FFMPEG_BIN` 和 `FFPROBE_BIN` 指定完整路径。

### 首次识别很慢

首次运行可能需要下载 YOLO 模型，并初始化 Ultralytics 推理环境。后续启动会更快。

### 主角跟踪偶尔串人

当前项目使用 YOLO + ByteTrack，并做了基于颜色外观签名的碎轨合并，但还没有接入完整 ReID。多人快速交叉、遮挡、服装相似时，建议通过主角关键帧手动修正。

### 导出速度慢

默认编码参数偏向高质量输出。可以降低导出帧率，或使用更快的编码预设：

```bash
EXPORT_PRESET=medium EXPORT_CRF=18 python studio_server.py
```

## 当前限制

- 尚未接入完整 ReID，复杂遮挡后仍可能出现人物 ID 切换
- 当前遮挡基于检测框，不是精细人体分割
- 长视频逐帧渲染耗时较长，暂未实现后台任务队列
- 默认使用 CPU 推理与渲染，大分辨率视频会比较吃性能
- 浏览器端回退导出的质量和稳定性低于本地 FFmpeg 导出

## 后续方向

- 接入 ReID，提升多人交叉场景下的主角稳定性
- 增加 BoT-SORT 等跟踪器切换选项
- 增加人工补框、锁定框、删除误检轨迹等精修能力
- 增加任务队列，支持长视频、批量导出和导出进度恢复
- 增加 GPU 推理选项，提高长视频分析速度
- 增加更精细的人体分割遮挡模式

## 许可证

本项目基于 [MIT License](LICENSE) 开源。

---

*本项目由 AI 编程助手 Codex 辅助生成。*
