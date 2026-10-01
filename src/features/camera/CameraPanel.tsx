import { useEffect, useRef, useState } from 'react';
import { CameraController, type CameraState } from '../../core/tracking/CameraController';
import type { TrackingFrame } from '../../core/contracts';
interface Props {
  onFrame: (frame: TrackingFrame) => void; onState: (state: CameraState) => void;
  mirror: boolean; showVideo: boolean; disabled?: boolean;
  onController?: (controller: CameraController | null) => void;
}
const labels: Record<CameraState, string> = { idle: '摄像头已关闭', starting: '正在启动…', running: '追踪运行中', paused: '已暂停 · 摄像头保持连接', error: '启动失败' };
export function CameraPanel(props: Props) {
  const video = useRef<HTMLVideoElement>(null), controller = useRef<CameraController | null>(null), callbacks = useRef(props);
  callbacks.current = props;
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]), [selected, setSelected] = useState('');
  const [state, setState] = useState<CameraState>('idle'), [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try { const all = await navigator.mediaDevices?.enumerateDevices(); if (alive) setDevices(all?.filter(d => d.kind === 'videoinput') ?? []); } catch { /* permission handled on start */ }
    };
    const instance = new CameraController(video.current!, {
      onFrame: f => callbacks.current.onFrame(f),
      onState: s => { if (alive) { setState(s); callbacks.current.onState(s); if (s === 'running') void refresh(); } },
      onError: e => { if (alive) setError(e); },
    });
    controller.current = instance; callbacks.current.onController?.(instance);
    void refresh(); navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return () => { alive = false; instance.dispose(); callbacks.current.onController?.(null); navigator.mediaDevices?.removeEventListener('devicechange', refresh); };
  }, []);
  return <section className="panel camera-panel"><div className="section-heading"><span className="step">02</span><h2>摄像头</h2><span className={`status-dot ${state === 'running' ? 'active' : ''}`} /></div>
    <div className={`camera-feed ${props.showVideo ? '' : 'hidden-video'}`}><video ref={video} muted playsInline style={{ transform: props.mirror ? 'scaleX(-1)' : undefined }} />
      {(state === 'idle' || state === 'error' || !props.showVideo) && <div className="camera-placeholder">◎<span>{props.showVideo ? '准备好时，开启摄像头' : '摄像头预览已隐藏'}</span></div>}</div>
    <label className="field">输入设备<select aria-label="输入设备" value={selected} disabled={state === 'starting'} onChange={e => { setSelected(e.target.value); controller.current?.stop(); }}><option value="">系统默认摄像头</option>{devices.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `摄像头 ${i + 1}`}</option>)}</select></label>
    <div className="button-row">{['idle','error'].includes(state) ? <button className="primary" disabled={props.disabled} onClick={() => void controller.current?.start(selected)}>开启摄像头</button> : <>
      <button disabled={state === 'starting' || props.disabled} onClick={() => state === 'paused' ? controller.current?.resume() : controller.current?.pause()}>{state === 'paused' ? '继续追踪' : '暂停追踪'}</button><button onClick={() => controller.current?.stop()}>关闭摄像头</button></>}</div>
    <p className="muted">{labels[state]}</p>{error && <p className="error" role="alert">{error}</p>}
    <p className="micro">本机处理 · 单人 · Worker CPU · 图像不上传</p>
  </section>;
}
export default CameraPanel;
