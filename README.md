# Dance-Focus

一个舞蹈视频处理网站，核心做两件事：

- 自动识别视频里的人物，并对非保留对象打码
- 从横屏素材中裁出单人 9:16 直拍，同时把误入画面的其他人自动打码

## 当前能力

- 本地上传视频
- 导入视频后自动初始化本地 YOLO 连接状态
- 当前默认识别模型
  - `YOLO11n Person Detector`
- 自动生成人物轨迹列表，可设定主舞者
- `单人直拍` 和 `全画面打码` 两种模式
- 支持马赛克、模糊、纯色遮挡三种处理方式
- 支持入点/出点、裁切留白、安全边距、平滑参数
- 支持主角关键帧：`设为全程主角` 与 `从此刻切换`
- 支持 `原视频高度 9:16` 和 `原视频分辨率` 两类高规格输出
- 优先使用本地 `Python + NumPy + FFmpeg` 逐帧渲染并输出高帧率 `MP4(H.264 + AAC)`
- 本地服务不可用时，才回退浏览器 `MediaRecorder/WebCodecs`
- 本地保存最近导出历史

## 从零开始运行

如果你这台电脑什么都没装，按以下步骤来：

### 1. 安装 Homebrew（macOS 包管理器）

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 2. 安装 FFmpeg

```bash
brew install ffmpeg
```

### 3. 安装 Python 依赖

```bash
pip3 install ultralytics opencv-python-headless numpy
```

### 4. 克隆本项目

```bash
git clone git@github.com:baiyj0123/Dance-Focus.git
cd Dance-Focus
```

### 5. 启动

```bash
python3 studio_server.py
```

然后浏览器访问 `http://127.0.0.1:4818`。

> 首次启动会自动下载 YOLO11n 模型（约 6MB），请保持网络通畅。

## 运行方式

如果依赖已就绪，直接：

```bash
python3 studio_server.py
```

这样前端和本地 FFmpeg 导出会一起可用，浏览器访问 `http://127.0.0.1:4818`。

## 依赖说明

- 本地识别：`/usr/bin/python3 + ultralytics + opencv-python-headless`
- 检测模型：`YOLO11n`
- 跟踪器：`ByteTrack`
- 轨迹补强：基于外观签名的碎轨合并
- 本地渲染：`python3 + numpy + ffmpeg`
- 导出容器：`mp4`

## 当前限制

- 当前已经接入 `YOLO + ByteTrack`，但还没有 `ReID`，所以多人快速交叉、长时间遮挡后仍建议配合关键帧切主角
- 当前导出默认优先保留原视频高度，渲染缩放已切到 `OpenCV Lanczos`，编码默认 `H.264 CRF 12 + veryslow`
- 本地逐帧渲染质量已经明显高于浏览器导出，但速度会慢于纯转码
- 模糊/马赛克由本地 NumPy 渲染实现，已经够用，但还不是影视级遮罩分割

## 下一步建议

1. 接入 `ReID`，降低主角串人概率
2. 增加可切换 `BoT-SORT`
3. 增加人工补框和锁定关键帧
4. 改成本地任务队列，支持长视频和批量导出
