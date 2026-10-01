// A classic Worker intentionally: MediaPipe's WASM loader uses importScripts.
// Only the ES module distribution is imported dynamically, from our own origin.
interface FaceResult {
  faceLandmarks: Array<Array<{ x: number; y: number; z: number }>>;
  faceBlendshapes: Array<{ categories: Array<{ categoryName: string; score: number }> }>;
  facialTransformationMatrixes: Array<{ data: number[] }>;
}
interface FaceTask {
  detectForVideo(image: ImageBitmap, timestamp: number): FaceResult;
  close(): void;
}
let faceTask: FaceTask | undefined;
let initializing = false;
const workerScope = self as unknown as {
  onmessage: (event: MessageEvent) => void;
  postMessage: (message: unknown) => void;
};
workerScope.onmessage = async (event: MessageEvent) => {
  const message = event.data;
  if (message.type === 'init') {
    if (initializing || faceTask) return;
    initializing = true;
    try {
      const base = new URL(message.assetsBase);
      if (base.origin !== self.location.origin) throw new Error('追踪资源必须来自本地应用。');
      const moduleUrl = new URL('vision_bundle.mjs', base).href;
      const vision = await import(/* @vite-ignore */ moduleUrl);
      const files = await vision.FilesetResolver.forVisionTasks(new URL('wasm', base).href);
      faceTask = await vision.FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: new URL('face_landmarker.task', base).href, delegate: 'CPU' },
        runningMode: 'VIDEO', numFaces: 1,
        outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      workerScope.postMessage({ type: 'ready' });
    } catch (error) {
      workerScope.postMessage({ type: 'error', message: `追踪资源加载失败。请先运行 pnpm assets:setup。${error instanceof Error ? error.message : ''}` });
    } finally { initializing = false; }
  } else if (message.type === 'frame') {
    const bitmap = message.bitmap as ImageBitmap;
    try {
      if (!faceTask) throw new Error('追踪器尚未就绪。');
      const start = performance.now();
      const result = faceTask.detectForVideo(bitmap, message.timestamp);
      // Copy plain data only. No camera pixels cross this boundary on the return path.
      workerScope.postMessage({ type: 'result', result, timestamp: message.timestamp,
        inferenceMs: performance.now() - start });
    } catch (error) {
      workerScope.postMessage({ type: 'error', message: `面部识别失败：${error instanceof Error ? error.message : String(error)}` });
    } finally { bitmap.close(); }
  } else if (message.type === 'dispose') {
    faceTask?.close();
    faceTask = undefined;
  }
};
