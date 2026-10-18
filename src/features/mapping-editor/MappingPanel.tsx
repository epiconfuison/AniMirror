import { useState } from 'react';
import type { ChannelTuning, ModelCapabilities, ModelProfile } from '../../core/contracts';
import { DEFAULT_TUNING } from '../../core/contracts';
import { driveTargets } from '../../core/adapters/capabilities';
import { INPUT_CHANNELS, suggestMappings } from '../../core/retargeting';

export function MappingPanel({ profile, capabilities, onChange, onTest }: {
  profile: ModelProfile; capabilities: ModelCapabilities; onChange: (p: ModelProfile) => void; onTest: (target: string, value: number) => void;
}) {
  const [channel, setChannel] = useState('jawOpen');
  // Only targets the loaded model really exposes are offered, so a Cubism model never
  // shows VRM expression names and vice versa.
  const targets = driveTargets(capabilities);
  const available = new Set(targets.map(target => target.id));
  const signed = new Map(targets.map(target => [target.id, target.signed]));
  const tuning = profile.tuning[channel] ?? DEFAULT_TUNING;
  const adjust = (key: keyof ChannelTuning, value: number) => onChange({ ...profile, tuning: { ...profile.tuning, [channel]: { ...tuning, [key]: value } } });
  const update = (id: string, patch: (rule: ModelProfile['mappings'][number]) => ModelProfile['mappings'][number]) =>
    onChange({ ...profile, mappings: profile.mappings.map(rule => rule.id === id ? patch(rule) : rule) });
  return <section className="panel"><div className="section-heading"><h2>表情映射</h2><span className="tag">{profile.mappings.length} 条规则</span></div>
    <p className="micro">按角色自身的左右命名。近似映射需要试动并确认；多个输入按权重相加，每个目标只写入一次。{capabilities.format === 'live2d' ? '目标为模型实际参数 ID。' : ''}</p>
    {!targets.length && <p className="notice">此模型没有可驱动目标，仅头部追踪可用。</p>}
    <div className="mapping-list">{profile.mappings.map((rule, i) => {
      const missing = !available.has(rule.target);
      return <div className="mapping-rule" key={rule.id}>
        <label className="check"><input aria-label={`启用规则 ${i + 1}`} type="checkbox" checked={rule.enabled} onChange={e => update(rule.id, r => ({ ...r, enabled: e.target.checked }))} /><span>输入 → 角色目标</span></label>
        <select aria-label={`输入通道 ${i + 1}`} value={rule.input} onChange={e => update(rule.id, r => ({ ...r, input: e.target.value, confirmed: false, approximate: true }))}>{INPUT_CHANNELS.map(c => <option value={c.name} key={c.name}>{c.label}</option>)}</select>
        <select aria-label={`目标表情 ${i + 1}`} value={rule.target} onChange={e => update(rule.id, r => ({ ...r, target: e.target.value, confirmed: false, approximate: true }))}>{missing && <option value={rule.target}>{rule.target}（当前模型不支持）</option>}{targets.map(t => <option key={t.id} value={t.id}>{t.id === t.label ? t.id : `${t.label} · ${t.id}`}</option>)}</select>
        <div className="button-row"><label className="weight">权重<input aria-label={`权重 ${i + 1}`} type="number" min="-2" max="2" step="0.1" value={rule.weight} onChange={e => update(rule.id, r => ({ ...r, weight: Math.max(-2, Math.min(2, Number(e.target.value))) }))} /></label><button onClick={() => onTest(rule.target, 1)}>试动</button><button aria-label={`删除规则 ${i + 1}`} onClick={() => onChange({ ...profile, mappings: profile.mappings.filter(r => r.id !== rule.id) })}>×</button></div>
        <div className="button-row"><label className="check"><input aria-label={`反向规则 ${i + 1}`} type="checkbox" checked={Boolean(rule.invert)} onChange={e => update(rule.id, r => ({ ...r, invert: e.target.checked }))} />反向（用 1 − 输入）</label>
          {signed.get(rule.target) && <label className="check"><input aria-label={`双向规则 ${i + 1}`} type="checkbox" checked={Boolean(rule.signed)} onChange={e => update(rule.id, r => ({ ...r, signed: e.target.checked }))} />双向（允许负值）</label>}</div>
        {missing && <p className="notice">当前模型缺少目标 {rule.target}，此规则不会驱动任何参数。</p>}
        {rule.approximate && <label className="check approximate"><input type="checkbox" checked={rule.confirmed} onChange={e => update(rule.id, r => ({ ...r, confirmed: e.target.checked }))} />近似映射 · {rule.confirmed ? '已确认' : '待确认，暂不驱动'}</label>}
      </div>;
    })}</div>
    <div className="button-row"><button disabled={!targets.length} onClick={() => onChange({ ...profile, mappings: [...profile.mappings, { id: crypto.randomUUID(), input: channel, target: targets[0]!.id, weight: 1, enabled: true, approximate: true, confirmed: false }] })}>＋ 添加映射</button><button onClick={() => onChange({ ...profile, mappings: suggestMappings(capabilities) })}>重置建议</button><button onClick={() => onTest('', 0)}>停止试动</button></div>
    <details><summary>通道响应与形变限制</summary><label className="field">输入通道<select value={channel} onChange={e => setChannel(e.target.value)}>{INPUT_CHANNELS.map(c => <option key={c.name} value={c.name}>{c.label}</option>)}</select></label>
      {([['gain', '增益', 0, 3], ['deadZone', '死区', 0, .95], ['min', '下限', 0, tuning.max], ['max', '上限', tuning.min, 1], ['curve', '响应曲线', .1, 4]] as const).map(([key, label, min, max]) => <label className="slider" key={key}><span>{label}<output>{tuning[key].toFixed(2)}</output></span><input type="range" min={min} max={max} step="0.01" value={tuning[key]} onChange={e => adjust(key, Number(e.target.value))} /></label>)}
      <button onClick={() => onChange({ ...profile, tuning: { ...profile.tuning, [channel]: { ...DEFAULT_TUNING } } })}>重置此通道</button>
    </details>
  </section>;
}
