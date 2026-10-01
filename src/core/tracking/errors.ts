/** User-facing failures, kept separate so device recovery remains testable. */
export function cameraErrorMessage(error: unknown): string {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError': return '摄像头权限被拒绝。请在浏览器地址栏允许摄像头，然后重试。';
    case 'NotFoundError':
    case 'DevicesNotFoundError': return '没有找到摄像头。请连接设备后重新选择。';
    case 'NotReadableError':
    case 'TrackStartError': return '摄像头无法启动，可能被其他应用占用。请关闭占用程序后重试。';
    case 'OverconstrainedError': return '所选摄像头不可用或已拔出。请重新选择设备。';
    case 'SecurityError': return '浏览器安全设置阻止了摄像头。请使用 localhost 或 HTTPS。';
    case 'AbortError': return '摄像头启动中断，请重试。';
    default: return error instanceof Error ? error.message : '摄像头或追踪器发生错误，请停止后重试。';
  }
}
