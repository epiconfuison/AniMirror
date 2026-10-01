import { useEffect, useRef, useState, type RefObject } from 'react';
import type { TrackingFrame, UserCalibration } from '../../core/contracts';
import { CALIBRATION_STEPS, CalibrationCollector, type CalibrationStep } from '../../core/retargeting';
export function CalibrationPanel({ frame, value, onChange, running }: { frame: RefObject<TrackingFrame | null>; value?: UserCalibration; onChange: (c: UserCalibration | undefined) => Promise<void>; running: boolean }) {
  const [step, setStep] = useState<CalibrationStep>('neutral'), [active, setActive] = useState(false), [samples, setSamples] = useState(0), [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const collector = useRef(new CalibrationCollector(value));
  const callback = useRef(onChange); callback.current = onChange;
  const persist = async (next: UserCalibration | undefined) => {
    setSaving(true); setMessage('正在保存个人校准…');
    try {
      await callback.current(next);
      if (mounted.current) { setMessage(next ? '本步已保存。可以继续下一步或重新采集。' : '个人校准已重置。'); if (!next) setStep('neutral'); }
    } catch (error) {
      if (mounted.current) setMessage(`保存未完成：${error instanceof Error ? error.message : String(error)}`);
    } finally { if (mounted.current) setSaving(false); }
  };
  useEffect(() => {
    if (!active) return;
    const deadline = performance.now() + 3000;
    const timer = setInterval(() => {
      if (frame.current) setSamples(collector.current.add(frame.current));
      if (performance.now() >= deadline) {
        clearInterval(timer); setActive(false);
        const result = collector.current.finish();
        if (result.ok) void persist(result.calibration);
        else setMessage(result.error);
      }
    }, 40);
    return () => clearInterval(timer);
  }, [active, frame]);
  useEffect(() => { if (!running && active) { setActive(false); setMessage('采集已中断，请重新采集本步骤。'); } }, [running, active]);
  const current = CALIBRATION_STEPS.find(s => s.id === step)!;
  return <section className="panel"><div className="section-heading"><span className="step">03</span><h2>个人校准</h2><span className="tag">跨模型复用</span></div>
    <div className="calibration-steps">{CALIBRATION_STEPS.map(s => <button key={s.id} disabled={active || saving || (s.id !== 'neutral' && !value)} className={step === s.id ? 'selected' : ''} onClick={() => { setStep(s.id); setMessage(''); }}>{value?.quality[s.id] ? '✓ ' : ''}{s.label}</button>)}</div>
    <p>{current.instruction}</p><p className="micro">每步采集 3 秒，只接收有效人脸；至少 15 帧。重新采集中性脸会清除旧动作幅度。</p>
    <button className="primary" disabled={!running || active || saving} onClick={() => { collector.current = new CalibrationCollector(value); collector.current.start(step); setSamples(0); setMessage(''); setActive(true); }}>{active ? `采集中 · ${samples} 帧` : `采集${current.label}`}</button>
    <p role="status" className="muted">{message || (running ? '先放松面部，完成中性脸，再依次采集动作。' : '开启摄像头后开始校准。')}</p>
    {value && <button className="text-button" disabled={active || saving} onClick={() => void persist(undefined)}>重置个人校准</button>}
  </section>;
}
