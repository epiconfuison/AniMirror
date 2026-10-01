import { useState } from 'react';
import type { AvatarCapabilities, ChannelTuning, ModelProfile } from '../../core/contracts';
import { DEFAULT_TUNING } from '../../core/contracts';
import { INPUT_CHANNELS, suggestMappings } from '../../core/retargeting';
export function MappingPanel({ profile, capabilities, onChange, onTest }: { profile: ModelProfile; capabilities: AvatarCapabilities; onChange: (p: ModelProfile) => void; onTest: (target: string, value: number) => void }) {
  const [channel, setChannel] = useState('jawOpen');
  const targets = capabilities.expressions.filter(e => e.bindCount > 0);
  const tuning = profile.tuning[channel] ?? DEFAULT_TUNING;
  const adjust = (key: keyof ChannelTuning, value: number) => onChange({ ...profile, tuning: { ...profile.tuning, [channel]: { ...tuning, [key]: value } } });
  return <section className="panel"><div className="section-heading"><h2>表情映射</h2><span className="tag">{profile.mappings.length} 条规则</span></div>
    <p className="micro">按角色自身的左右命名。近似映射需要试动并确认；多个输入按权重相加，每个目标只写入一次。</p>
    {!targets.length && <p className="notice">此模型没有有效表情绑定，可继续使用头部追踪。</p>}
    <div className="mapping-list">{profile.mappings.map((rule, i) => <div className="mapping-rule" key={rule.id}>
      <label className="check"><input aria-label={`启用规则 ${i + 1}`} type="checkbox" checked={rule.enabled} onChange={e => onChange({ ...profile, mappings: profile.mappings.map(r => r.id === rule.id ? { ...r, enabled: e.target.checked } : r) })} /><span>输入 → 角色表情</span></label>
      <select aria-label={`输入通道 ${i + 1}`} value={rule.input} onChange={e => onChange({ ...profile, mappings: profile.mappings.map(r => r.id === rule.id ? { ...r, input: e.target.value, confirmed: false, approximate: true } : r) })}>{INPUT_CHANNELS.map(c => <option value={c.name} key={c.name}>{c.label}</option>)}</select>
      <select aria-label={`目标表情 ${i + 1}`} value={rule.target} onChange={e => onChange({ ...profile, mappings: profile.mappings.map(r => r.id === rule.id ? { ...r, target: e.target.value, confirmed: false, approximate: true } : r) })}>{targets.map(t => <option key={t.name}>{t.name}</option>)}</select>
      <div className="button-row"><label className="weight">权重<input aria-label={`权重 ${i + 1}`} type="number" min="-2" max="2" step="0.1" value={rule.weight} onChange={e => onChange({ ...profile, mappings: profile.mappings.map(r => r.id === rule.id ? { ...r, weight: Math.max(-2, Math.min(2, Number(e.target.value))) } : r) })} /></label><button onClick={() => onTest(rule.target, 1)}>试动</button><button aria-label={`删除规则 ${i + 1}`} onClick={() => onChange({ ...profile, mappings: profile.mappings.filter(r => r.id !== rule.id) })}>×</button></div>
      {rule.approximate && <label className="check approximate"><input type="checkbox" checked={rule.confirmed} onChange={e => onChange({ ...profile, mappings: profile.mappings.map(r => r.id === rule.id ? { ...r, confirmed: e.target.checked } : r) })} />近似映射 · {rule.confirmed ? '已确认' : '待确认，暂不驱动'}</label>}
    </div>)}</div>
    <div className="button-row"><button disabled={!targets.length} onClick={() => onChange({ ...profile, mappings: [...profile.mappings, { id: crypto.randomUUID(), input: channel, target: targets[0]!.name, weight: 1, enabled: true, approximate: true, confirmed: false }] })}>＋ 添加映射</button><button onClick={() => onChange({ ...profile, mappings: suggestMappings(capabilities) })}>重置建议</button><button onClick={() => onTest('', 0)}>停止试动</button></div>
    <details><summary>通道响应与形变限制</summary><label className="field">输入通道<select value={channel} onChange={e => setChannel(e.target.value)}>{INPUT_CHANNELS.map(c => <option key={c.name} value={c.name}>{c.label}</option>)}</select></label>
      {([['gain', '增益', 0, 3], ['deadZone', '死区', 0, .95], ['min', '下限', 0, tuning.max], ['max', '上限', tuning.min, 1], ['curve', '响应曲线', .1, 4]] as const).map(([key, label, min, max]) => <label className="slider" key={key}><span>{label}<output>{tuning[key].toFixed(2)}</output></span><input type="range" min={min} max={max} step="0.01" value={tuning[key]} onChange={e => adjust(key, Number(e.target.value))} /></label>)}
      <button onClick={() => onChange({ ...profile, tuning: { ...profile.tuning, [channel]: { ...DEFAULT_TUNING } } })}>重置此通道</button>
    </details>
  </section>;
}
