import { CubismFramework, LogLevel, Option } from '../../vendor/cubism/framework/live2dcubismframework';

/**
 * Raised when the Cubism Core script is missing or the framework cannot start. The UI
 * reports it as an actionable error instead of a generic load failure.
 */
export class CubismUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'CubismUnavailableError'; }
}

let started = false;

export function isCubismCoreAvailable(): boolean {
  return typeof (globalThis as unknown as { Live2DCubismCore?: unknown }).Live2DCubismCore !== 'undefined';
}

export function isCubismRuntimeStarted(): boolean { return started; }

/**
 * Starts the framework exactly once for the whole application. Cubism Core is a classic
 * script loaded before the app bundle, so a missing Core is reported explicitly rather
 * than surfacing as an obscure null reference.
 */
export function ensureCubismRuntime(log: (message: string) => void = () => {}): void {
  if (!isCubismCoreAvailable()) {
    throw new CubismUnavailableError('Live2D Cubism Core 未加载：缺少 public/vendor/live2dcubismcore.min.js，或它没有在应用脚本之前加载。');
  }
  if (started) return;
  const option = new Option();
  option.logFunction = log;
  option.loggingLevel = LogLevel.LogLevel_Error;
  if (!CubismFramework.startUp(option)) throw new CubismUnavailableError('Live2D Cubism SDK 初始化失败。');
  CubismFramework.initialize();
  started = true;
}
