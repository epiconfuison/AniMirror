import { useCallback, useEffect, useRef, useState } from 'react';
import type { AvatarAsset, AvatarCapabilities, DriveOutput, ModelProfile, TrackingFrame, UISettings, UserCalibration } from '../core/contracts';
import { DEFAULT_UI } from '../core/contracts';
import { createDefaultProfile, INPUT_CHANNELS, Retargeter } from '../core/retargeting';
import { parseBundle, ProfileRepository, serializeBundle } from '../core/profiles';
import { AvatarStage } from '../features/preview/AvatarStage';
import { CameraPanel } from '../features/camera/CameraPanel';
import { CalibrationPanel } from '../features/calibration/CalibrationPanel';
import { MappingPanel } from '../features/mapping-editor/MappingPanel';
import { appendRecordingFrame, evaluateRecording, parseRecording, type ParameterRecording } from '../features/diagnostics/recording';
import type { CameraController, CameraState } from '../core/tracking/CameraController';
import { ConfigurationQueue } from './configuration';

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const EMPTY_OUTPUT: DriveOutput = { expressions: {}, rotation: { x: 0, y: 0, z: 0 }, tracking: 'lost' };

export default function App() {
  const host = useRef<HTMLDivElement>(null), stage = useRef<AvatarStage | null>(null);
  const repository = useRef(new ProfileRepository()), engine = useRef(new Retargeter());
  const fileInput = useRef<HTMLInputElement>(null), frame = useRef<TrackingFrame | null>(null), camera = useRef<CameraController | null>(null);
  const [asset, setAsset] = useState<AvatarAsset>(), [capabilities, setCapabilities] = useState<AvatarCapabilities>();
  const [profile, setProfile] = useState<ModelProfile>(), [calibration, setCalibration] = useState<UserCalibration>();
  const [ui, setUI] = useState<UISettings>({ ...DEFAULT_UI }), [cameraState, setCameraState] = useState<CameraState>('idle');
  const [notice, setNotice] = useState(''), [failure, setFailure] = useState(''), [loading, setLoading] = useState<number | null>(null);
  const [fps, setFps] = useState(0), [clean, setClean] = useState(false), [tab, setTab] = useState<'drive' | 'mapping'>('drive');
  const [snapshot, setSnapshot] = useState({ frame: null as TrackingFrame | null, output: EMPTY_OUTPUT, rate: 0, p95: 0 });
  const output = useRef(EMPTY_OUTPUT), manual = useRef<{ target: string; until: number }>({ target: '', until: 0 });
  const current = useRef({ profile, calibration, ui }); current.current = { profile, calibration, ui };
  const importing = useRef(false), inferCount = useRef(0), processing = useRef<number[]>([]), lastMeasured = useRef(-1), appliedTimestamp = useRef<number | null>(null);
  const configQueue = useRef(new ConfigurationQueue()), restoreRevision = useRef({ ui: 0, calibration: 0 });
  const [configurationBusy, setConfigurationBusy] = useState(false), [calibrationSession, setCalibrationSession] = useState(0);
  const recording = useRef<{ start: number; frames: TrackingFrame[] } | null>(null), [recorded, setRecorded] = useState<ParameterRecording>(), [isRecording, setIsRecording] = useState(false);
  const playback = useRef<{ start: number; outputs: DriveOutput[] } | null>(null), [isPlaying, setIsPlaying] = useState(false);
  const onFrame = useCallback((next: TrackingFrame) => {
    frame.current = next; inferCount.current++;
    const rec = recording.current;
    if (rec) appendRecordingFrame(rec, next);
  }, []);
  const onCameraState = useCallback((state: CameraState) => { setCameraState(state); if (state !== 'running') frame.current = null; }, []);
  useEffect(() => {
    let alive = true, raf = 0;
    try { stage.current = new AvatarStage(host.current!, setFps, (renderNow: number) => {
      if (appliedTimestamp.current === null || appliedTimestamp.current === lastMeasured.current) return;
      lastMeasured.current = appliedTimestamp.current;
      processing.current.push(Math.max(0, renderNow - appliedTimestamp.current));
      if (processing.current.length > 300) processing.current.shift();
    }); } catch (e) { setFailure(`三维预览无法启动：${errorText(e)}`); }
    const repo = repository.current;
    const restoreToken = configQueue.current.token, restoreAtStart = { ...restoreRevision.current };
    void Promise.allSettled([repo.getUI(), repo.getCalibration()]).then(results => {
      if (!alive || !configQueue.current.isCurrent(restoreToken)) return;
      if (restoreRevision.current.ui === restoreAtStart.ui && results[0].status === 'fulfilled' && results[0].value) { current.current.ui = results[0].value; setUI(results[0].value); }
      if (restoreRevision.current.calibration === restoreAtStart.calibration && results[1].status === 'fulfilled' && results[1].value) { current.current.calibration = results[1].value; setCalibration(results[1].value); setCalibrationSession(value => value + 1); }
      const rejected = results.find(r => r.status === 'rejected');
      if (rejected?.status === 'rejected') setNotice(`本地配置未恢复，可重置或导入 JSON：${errorText(rejected.reason)}`);
    });
    const tick = (now: number) => {
      const p = current.current.profile;
      if (playback.current) {
        appliedTimestamp.current = null;
        const index = Math.floor((now - playback.current.start) * 60 / 1000);
        const value = playback.current.outputs[Math.min(index, playback.current.outputs.length - 1)];
        if (value) { output.current = value; stage.current?.apply(value); }
        if (index >= playback.current.outputs.length) { playback.current = null; setIsPlaying(false); engine.current.reset(); }
      } else if (p && !importing.current) {
        const overrides = manual.current.until > now && manual.current.target ? { [manual.current.target]: 1 } : {};
        output.current = engine.current.update(frame.current, p, current.current.calibration, now, overrides);
        stage.current?.apply(output.current);
        appliedTimestamp.current = output.current.tracking === 'live' && frame.current?.faceDetected ? frame.current.timestamp : null;
      }
      const rec = recording.current;
      if (rec && now - rec.start >= 30000) {
        recording.current = null; setIsRecording(false);
        if (rec.frames.length) setRecorded({ schemaVersion: 1, durationMs: 30000, frames: rec.frames });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const diagnostic = setInterval(() => {
      const sorted = [...processing.current].sort((a,b) => a-b);
      setSnapshot({ frame: frame.current, output: output.current, rate: inferCount.current, p95: sorted[Math.floor(sorted.length * .95)] ?? 0 }); inferCount.current = 0;
    }, 1000);
    return () => { alive = false; configQueue.current.begin(); cancelAnimationFrame(raf); clearInterval(diagnostic); stage.current?.dispose(); stage.current = null; void repo.close(); };
  }, []);
  useEffect(() => { stage.current?.setBackground(ui.background); stage.current?.setFraming(ui.framing); }, [ui.background, ui.framing]);
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setClean(false); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, []);

  const stopReplay = () => { playback.current = null; setIsPlaying(false); appliedTimestamp.current = null; engine.current.reset(); };
  const changeProfile = (value: ModelProfile) => { if (playback.current) stopReplay(); current.current.profile = value; setProfile(value); };
  const changeUI = (value: UISettings) => { restoreRevision.current.ui++; current.current.ui = value; setUI(value); };

  const importModel = async (file: File) => {
    if (importing.current || configurationBusy || !stage.current) return;
    stopReplay(); appliedTimestamp.current = null;
    importing.current = true; setLoading(0); setFailure(''); setNotice('');
    try {
      const result = await stage.current.load(file, setLoading);
      setAsset(result.asset); setCapabilities(result.capabilities);
      let saved: ModelProfile | undefined;
      try { saved = await repository.current.getModel(result.asset.assetId, result.capabilities); } catch (e) { setNotice(`旧配置不可用，已使用默认值：${errorText(e)}`); }
      const next = saved ?? createDefaultProfile(result.asset.assetId, result.asset.name, result.capabilities);
      setProfile(next); current.current.profile = next; engine.current.reset(); manual.current = { target: '', until: 0 }; playback.current = null; setIsPlaying(false);
      stage.current.setFraming(current.current.ui.framing);
      if (saved) setNotice('已按模型文件哈希恢复配置。');
    } catch (e) { setFailure(errorText(e)); }
    finally { importing.current = false; setLoading(null); }
  };
  const save = async () => {
    if (importing.current) return;
    const token = configQueue.current.begin(), values = structuredClone(current.current); setConfigurationBusy(true);
    try {
      const applied = await configQueue.current.run(token, async () => {
        if (values.profile) await repository.current.saveModel(values.profile);
        await repository.current.saveUI(values.ui);
        if (values.calibration) await repository.current.saveCalibration({ ...values.calibration, profileId: 'default' });
      });
      if (applied) { setNotice('配置已保存到此浏览器；再次导入同一模型即可恢复。'); setFailure(''); }
    } catch (e) { if (configQueue.current.isCurrent(token)) setFailure(errorText(e)); }
    finally { if (configQueue.current.isCurrent(token)) setConfigurationBusy(false); }
  };
  const changeCalibration = async (value: UserCalibration | undefined) => {
    const token = configQueue.current.begin(); restoreRevision.current.calibration++; setConfigurationBusy(true);
    const next = value ? { ...value, profileId: 'default' } : undefined;
    try {
      const applied = await configQueue.current.run(token, () => next ? repository.current.saveCalibration(next) : repository.current.removeCalibration());
      if (!applied) throw new Error('校准保存已取消，请重新采集。');
      if (playback.current) stopReplay(); current.current.calibration = next; setCalibration(next); engine.current.reset();
    } catch (e) { if (configQueue.current.isCurrent(token)) setFailure(errorText(e)); throw e; }
    finally { if (configQueue.current.isCurrent(token)) setConfigurationBusy(false); }
  };
  const importConfig = async (file: File) => {
    if (importing.current) return;
    const token = configQueue.current.begin(); setConfigurationBusy(true); setCalibrationSession(value => value + 1); stopReplay();
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('配置文件超过 2 MB。');
      const text = await file.text(); if (!configQueue.current.isCurrent(token)) return;
      const bundle = parseBundle(text, asset?.assetId, capabilities);
      if (bundle.model && !asset) throw new Error('请先导入配置所对应的 VRM 模型。');
      if (bundle.calibration) bundle.calibration.profileId = 'default';
      const applied = await configQueue.current.run(token, async () => {
        if (bundle.model) await repository.current.saveModel(bundle.model);
        if (bundle.calibration) await repository.current.saveCalibration(bundle.calibration);
        if (bundle.ui) await repository.current.saveUI(bundle.ui);
      });
      if (!applied) return;
      if (bundle.model) changeProfile(bundle.model);
      if (bundle.calibration) { restoreRevision.current.calibration++; current.current.calibration = bundle.calibration; setCalibration(bundle.calibration); }
      if (bundle.ui) changeUI(bundle.ui);
      engine.current.reset(); setNotice('配置校验通过，已导入并保存。'); setFailure('');
    } catch (e) { if (configQueue.current.isCurrent(token)) setFailure(errorText(e)); }
    finally { if (configQueue.current.isCurrent(token)) setConfigurationBusy(false); }
  };
  const clearAll = async () => {
    if (importing.current) return;
    const token = configQueue.current.begin(); setConfigurationBusy(true); setCalibrationSession(value => value + 1); stopReplay(); manual.current = { target: '', until: 0 };
    try {
      if (!await configQueue.current.run(token, () => repository.current.clear())) return;
      restoreRevision.current.calibration++; current.current.calibration = undefined; setCalibration(undefined); changeUI({ ...DEFAULT_UI });
      if (asset && capabilities) changeProfile(createDefaultProfile(asset.assetId, asset.name, capabilities));
      engine.current.reset(); setFailure(''); setNotice('本地配置已全部清除。当前默认值不会自动写回。');
    } catch (e) { if (configQueue.current.isCurrent(token)) setFailure(errorText(e)); }
    finally { if (configQueue.current.isCurrent(token)) setConfigurationBusy(false); }
  };
  const toggleRecording = () => {
    if (recording.current) {
      const rec = recording.current; recording.current = null; setIsRecording(false);
      if (rec.frames.length) setRecorded({ schemaVersion: 1, durationMs: Math.min(30000, performance.now() - rec.start), frames: rec.frames });
      else setNotice('未采集到参数帧，请先启动追踪。');
    } else { recording.current = { start: performance.now(), frames: [] }; setRecorded(undefined); setIsRecording(true); }
  };
  const startReplay = () => {
    if (!recorded || !profile) return;
    camera.current?.pause(); frame.current = null; engine.current.reset(); manual.current = { target: '', until: 0 }; appliedTimestamp.current = null;
    playback.current = { start: performance.now(), outputs: evaluateRecording(recorded, profile, calibration) }; setIsPlaying(true);
  };
  const supported = profile?.mappings.filter(r => r.enabled && (!r.approximate || r.confirmed)).length ?? 0;
  return <div className={`app ${clean ? 'clean' : ''}`}>
    <header className="topbar"><a className="brand" href="./"><span className="brand-mark">a<span>m</span></span><div>AniMirror<small>面部动作工作室</small></div></a><div className="top-status"><span className="status-dot active" />本地运行 <span className="divider">/</span> V1.0</div><button onClick={() => setClean(!clean)}>{clean ? '返回工作室 · Esc' : '简洁展示 ↗'}</button></header>
    {!clean && <div className="intro"><div><span className="eyebrow">YOUR EXPRESSION, IN MOTION</span><h1>让角色，跟随你的表情。</h1></div><p>导入角色 · 确认映射 · 校准面部<br />所有捕捉与渲染，都在你的电脑上完成。</p></div>}
    <main className="workspace">
      <aside className="left-column">
        <section className="panel"><div className="section-heading"><span className="step">01</span><h2>角色模型</h2><span className="tag">VRM 0 / 1</span></div>
          <input ref={fileInput} className="file-input" type="file" accept=".vrm" aria-label="导入 VRM 模型" onChange={e => { const f = e.target.files?.[0]; if (f) void importModel(f); e.target.value = ''; }} />
          <button className="dropzone" disabled={loading !== null || isPlaying || configurationBusy} onClick={() => fileInput.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!isPlaying && e.dataTransfer.files[0]) void importModel(e.dataTransfer.files[0]); }}><span className="upload-icon">↥</span><strong>{loading !== null ? `正在读取 ${loading}%` : asset ? '替换角色模型' : '拖入你的角色'}</strong><span>.vrm 格式 · 最大 100 MB</span></button>
          {loading !== null && <progress max="100" value={loading} />}
          {asset && <div className="asset-info"><strong>{asset.name}</strong><span>{(asset.file.size/1024/1024).toFixed(1)} MB · {capabilities?.vertexCount.toLocaleString()} 顶点</span></div>}
          {capabilities && <details open><summary>模型能力报告 <span className="tag">VRM {capabilities.version}</span></summary><p>{({ basic: '基础可用', face: '基础面捕可用', rich: '丰富面捕候选' })[capabilities.level]} · {supported} 条已启用映射</p><div className="chips"><span>头部 {capabilities.bones.head ? '✓' : '—'}</span><span>左眼骨骼 {capabilities.bones.leftEye ? '✓' : '—'}</span><span>右眼骨骼 {capabilities.bones.rightEye ? '✓' : '—'}</span></div>{capabilities.missing.map(m => <p className="notice" key={m}>{m}</p>)}<p className="micro">{capabilities.morphTargets.length} 个实际形变目标。丰富程度需逐通道试动确认。</p><div className="capability-list">{capabilities.expressions.map(e => <div key={e.name}><span>{e.name}<small>{e.preset ? '预设' : '自定义'} · {e.bindCount} 绑定</small></span><span>{!e.bindCount ? '不支持' : profile?.mappings.some(r => r.target === e.name && r.enabled && (!r.approximate || r.confirmed)) ? '可驱动' : '待映射'}</span></div>)}</div></details>}
        </section>
        <CameraPanel onFrame={onFrame} onState={onCameraState} mirror={ui.mirror} showVideo={ui.showVideo} disabled={isPlaying} onController={c => { camera.current = c; }} />
        <section className="privacy-note"><span>◈</span><p>你的模型，你的表情<small>摄像头画面与模型文件不会上传；诊断仅录制动作参数。</small></p></section>
      </aside>
      <section className="center-column"><div className="viewport-shell"><div ref={host} className="viewport" />
        <div className="viewport-top"><span className="view-label"><i className={`status-dot ${snapshot.output.tracking === 'live' ? 'active' : ''}`} />{isPlaying ? '参数回放' : snapshot.output.tracking === 'live' ? '人脸已识别' : snapshot.output.tracking === 'hold' ? '短暂保持' : '等待面部动作'}</span><span className="view-label">{fps} FPS</span></div>
        {!asset && <div className="empty-stage"><div className="portrait-outline"><span>＋</span></div><h2>你的角色，即将登场</h2><p>从左侧导入一个 VRM 模型<br />建立属于你的面部动作连接</p><span className="tag">准备好，从一个表情开始</span></div>}
        <div className="viewport-bottom"><span>{asset?.name ?? 'AVATAR PREVIEW'}</span><button onClick={() => stage.current?.resetView()}>↺ 重置视角</button></div></div>
        <div className="preview-tools"><div className="segmented"><button className={ui.framing === 'half' ? 'selected' : ''} onClick={() => changeUI({ ...ui, framing: 'half' })}>半身</button><button className={ui.framing === 'head' ? 'selected' : ''} onClick={() => changeUI({ ...ui, framing: 'head' })}>头部</button></div><label className="color-field">背景<input type="color" aria-label="背景颜色" value={ui.background} onChange={e => changeUI({ ...ui, background: e.target.value })} /></label><span className="micro">拖动旋转 · 滚轮缩放</span></div>
        {(failure || notice) && <div className={failure ? 'message error' : 'message'} role={failure ? 'alert' : 'status'}>{failure || notice}<button aria-label="关闭提示" onClick={() => { setFailure(''); setNotice(''); }}>×</button></div>}
        <section className="panel diagnostics"><details><summary>诊断与参数回放 <span className="micro">高级</span></summary><div className="metrics"><div><strong>{snapshot.rate}</strong><span>推理帧 / 秒</span></div><div><strong>{(snapshot.frame?.inferenceMs ?? 0).toFixed(1)}</strong><span>推理耗时 ms</span></div><div><strong>{snapshot.p95.toFixed(1)}</strong><span>处理 P95 ms</span></div></div><p className="micro">P95 为送入处理到动作提交的近似值，可能增加一帧渲染调度时间；非传感器到屏幕延迟。置信度未知，不用表情系数代替。</p>
          <div className="channel-values">{INPUT_CHANNELS.filter(c => profile?.mappings.some(r => r.input === c.name)).map(c => <label key={c.name}><span>{c.label}</span><meter min="0" max="1" value={snapshot.frame?.channels[c.name] ?? 0} /><output>{(snapshot.frame?.channels[c.name] ?? 0).toFixed(2)}</output></label>)}</div>
          <div className="button-row"><button disabled={cameraState !== 'running' && !isRecording} onClick={toggleRecording}>{isRecording ? '停止录制' : '录制参数 · 最多30秒'}</button><button disabled={!recorded || !profile || isRecording} onClick={() => { if (isPlaying) { playback.current = null; setIsPlaying(false); engine.current.reset(); } else startReplay(); }}>{isPlaying ? '停止回放' : '回放'}</button><button disabled={!recorded} onClick={() => recorded && download('ar-capture-recording.json', JSON.stringify(recorded))}>导出参数</button><label className="button-label">导入参数<input className="file-input" type="file" accept=".json" aria-label="导入参数录制" onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { try { if (f.size > 8_000_000) throw new Error('参数文件超过 8 MB'); setRecorded(parseRecording(await f.text())); } catch (err) { setFailure(errorText(err)); } } }} /></label></div><p className="micro">{recorded ? `${recorded.frames.length} 帧 · ${(recorded.durationMs/1000).toFixed(1)} 秒 · 固定60Hz虚拟时钟回放` : '仅保存具名系数和姿态，不保存视频。'}</p>
        </details></section>
      </section>
      <aside className="right-column"><div className="panel-tabs"><button className={tab === 'drive' ? 'selected' : ''} onClick={() => setTab('drive')}>驱动与校准</button><button className={tab === 'mapping' ? 'selected' : ''} onClick={() => setTab('mapping')}>映射与调节</button></div>
        {tab === 'drive' ? <><CalibrationPanel key={calibrationSession} frame={frame} value={calibration} running={cameraState === 'running' && !isPlaying && !configurationBusy && loading === null} onChange={changeCalibration} />
          <section className="panel"><div className="section-heading"><h2>动作表现</h2></div>{profile ? <><label className="field">风格预设<select value={profile.style} onChange={e => changeProfile({ ...profile, style: e.target.value as ModelProfile['style'] })}><option value="natural">自然 · 日常交流</option><option value="enhanced">增强 · 更鲜明的表情</option></select></label><label className="slider"><span>动作平滑<output>{profile.smoothing.toFixed(2)}</output></span><input type="range" min="0" max="1" step=".01" value={profile.smoothing} onChange={e => changeProfile({ ...profile, smoothing: Number(e.target.value) })} /></label><label className="slider"><span>头部增益<output>{profile.headGain.toFixed(2)}</output></span><input type="range" min="0" max="3" step=".05" value={profile.headGain} onChange={e => changeProfile({ ...profile, headGain: Number(e.target.value) })} /></label><details><summary>头部范围与视线</summary>{(['x','y','z'] as const).map((axis, i) => <label className="slider" key={axis}><span>{['点头','转头','歪头'][i]}<output>{Math.round(profile.headLimits[axis] * 180/Math.PI)}°</output></span><input type="range" min="0" max="90" value={profile.headLimits[axis] * 180/Math.PI} onChange={e => changeProfile({ ...profile, headLimits: { ...profile.headLimits, [axis]: Number(e.target.value)*Math.PI/180 } })} /></label>)}<label className="check"><input type="checkbox" checked={profile.eyeMode === 'expression'} onChange={e => changeProfile({ ...profile, eyeMode: e.target.checked ? 'expression' : 'off' })} />启用已映射的视线表情</label></details></> : <p className="muted">导入角色后可调节动作表现。</p>}
            <label className="check"><input type="checkbox" checked={ui.mirror} onChange={e => changeUI({ ...ui, mirror: e.target.checked })} />镜像摄像头预览</label><label className="check"><input type="checkbox" checked={ui.showVideo} onChange={e => changeUI({ ...ui, showVideo: e.target.checked })} />显示摄像头画面</label></section></> : profile && capabilities ? <MappingPanel profile={profile} capabilities={capabilities} onChange={changeProfile} onTest={target => { if (playback.current) stopReplay(); manual.current = { target, until: performance.now() + 1500 }; }} /> : <section className="panel"><p className="muted">导入模型后生成映射建议。</p></section>}
        <section className="panel config-panel"><div className="section-heading"><h2>保存与复用</h2></div><button className="primary full-width" disabled={configurationBusy || loading !== null} onClick={() => void save()}>保存配置</button><div className="button-row"><button onClick={() => download('ar-capture-config.json', serializeBundle({ schemaVersion: 1, ...(profile ? { model: profile } : {}), ...(calibration ? { calibration } : {}), ui }))}>导出 JSON</button><label className="button-label">导入 JSON<input type="file" className="file-input" accept=".json" aria-label="导入配置 JSON" onChange={e => { const f = e.target.files?.[0]; if (f) void importConfig(f); e.target.value = ''; }} /></label></div><p className="micro">模型配置绑定文件哈希；个人校准独立保存。刷新后需重新选择模型。</p><button className="text-button danger" onClick={() => void clearAll()}>清除全部本地配置</button></section>
      </aside>
    </main><footer>ANIMIRROR <span>一个表情，另一种呈现。</span><small>LOCAL FIRST · V1 PREVIEW</small></footer>
  </div>;
}
