# Dance-Focus

一个偏专业工作台的舞蹈室视频处理网站，核心做两件事：

- 自动识别视频里的人物，并对非保留对象打码
- 从横屏素材中裁出单人 9:16 直拍，同时把误入画面的其他人自动打码

## 当前能力

- 本地上传视频，不依赖后端
- 导入视频后自动初始化识别模型
- 当前默认识别模型
  - `EfficientDet Lite0 Person Detector`
- 自动生成人物轨迹列表，可设定主舞者
- `单人直拍` 和 `全画面打码` 两种模式
- 支持马赛克、模糊、纯色遮挡三种处理方式
- 支持入点/出点、裁切留白、安全边距、平滑参数
- 支持主角关键帧：`设为全程主角` 与 `从此刻切换`
- 支持 `原视频高度 9:16` 和 `原视频分辨率` 两类高规格输出
- 优先使用本地 `Python + NumPy + FFmpeg` 逐帧渲染并输出高帧率 `MP4(H.264 + AAC)`
- 本地服务不可用时，才回退浏览器 `MediaRecorder/WebCodecs`
- 本地保存最近导出历史

## 运行方式

最稳妥的方式是直接启动本地工作台服务：

```bash
cd "/Users/baiyinju/Library/Mobile Documents/com~apple~CloudDocs/dance-privacy-studio"
python3 studio_server.py
```

然后访问 `http://127.0.0.1:4818`。

这样前端和本地 FFmpeg 导出会一起可用。

如果你只是想先看界面，也可以直接打开 [`index.html`](/Users/baiyinju/Library/Mobile%20Documents/com~apple~CloudDocs/dance-privacy-studio/index.html)。

如果浏览器对 `file://` 下的模块加载有限制，建议用任意静态服务器打开目录，例如：

```bash
cd "/Users/baiyinju/Library/Mobile Documents/com~apple~CloudDocs/dance-privacy-studio"
python3 -m http.server 4318
```

然后访问 `http://127.0.0.1:4318`。

## 依赖说明

- 前端模型运行时：`@mediapipe/tasks-vision`
- 检测模型：Google 托管的 `efficientdet_lite0`
- 本地渲染：`python3 + numpy + ffmpeg`
- 导出容器：`mp4`

## 当前限制

- 依赖浏览器可访问 `jsDelivr` 和 `storage.googleapis.com`
- 当前仍是浏览器端推理，不是服务端 YOLO/ReID 专业跟踪栈，所以多人快速交叉时还可能需要关键帧切主角
- 如果要彻底锁住同一人，下一步应该接 `YOLO + ByteTrack/BoT-SORT + ReID`
- 本地逐帧渲染质量已经明显高于浏览器导出，但速度会慢于纯转码
- 模糊/马赛克由本地 NumPy 渲染实现，已经够用，但还不是影视级遮罩分割

## 后续更强版本

如果继续做下一版，优先级建议是：

1. 接入 `YOLO + ByteTrack/BoT-SORT + ReID`，让主角身份在遮挡后更稳
2. 接入人物分割模型，减少漏边和过度遮挡
3. 增加人工补框、锁头/锁身关键帧修正
4. 改成本地任务队列，支持长视频和批量导出

## YOLO 接入建议

当前最稳妥的路线不是再加浏览器端姿态模型，而是改成：

1. 用 Ultralytics YOLO 导出 `ONNX`
2. 在本地 Python 服务里用 `onnxruntime` 或继续用 `ffmpeg + python` 做逐帧推理
3. 只保留 `person` 类，再接 `ByteTrack/BoT-SORT` 做跟踪
4. 如果还要避免"主角串人"，再加 `ReID`

这样会比现在单纯靠检测框插值更适合舞蹈室多人横移、遮挡、换位场景。
