import type { ModelCapabilities, ModelProfile } from '../../core/contracts';
import { driveTargets, summarizeCapabilities } from '../../core/adapters/capabilities';

const LEVEL_LABEL = { basic: '基础可用', face: '基础面捕可用', rich: '丰富面捕候选' } as const;

/** Capability report for either format; only the format-specific extra line differs. */
export function CapabilityPanel({ capabilities, profile, supported }: {
  capabilities: ModelCapabilities; profile?: ModelProfile; supported: number;
}) {
  const summary = summarizeCapabilities(capabilities);
  const targets = driveTargets(capabilities);
  const driven = (target: string) => Boolean(profile?.mappings.some(rule => rule.target === target && rule.enabled && (!rule.approximate || rule.confirmed)));
  return <details open>
    <summary>模型能力报告 <span className="tag">{capabilities.format === 'vrm' ? `VRM ${capabilities.version}` : 'Live2D · Cubism 5'}</span></summary>
    <p>{LEVEL_LABEL[summary.level]} · {supported} 条已启用映射</p>
    <div className="chips">
      <span>头部 {summary.head ? '✓' : '—'}</span>
      <span>左眼 {summary.eyeLeft ? '✓' : '—'}</span>
      <span>右眼 {summary.eyeRight ? '✓' : '—'}</span>
      <span>嘴部 {summary.mouth ? '✓' : '—'}</span>
      {capabilities.format === 'live2d' && <>
        <span>微笑 {summary.smile ? '✓' : '—'}</span>
        <span>眉毛 {summary.brows ? '✓' : '—'}</span>
        <span>视线 {summary.gaze ? '✓' : '—'}</span>
      </>}
    </div>
    {summary.missing.map(message => <p className="notice" key={message}>{message}</p>)}
    <p className="micro">{capabilities.format === 'vrm'
      ? `${capabilities.morphTargets.length} 个实际形变目标。丰富程度需逐通道试动确认。`
      : `${capabilities.parameters.length} 个参数 · ${capabilities.textureCount} 张贴图 · ${capabilities.drawableCount} 个绘制对象${capabilities.hasPhysics ? ' · 物理' : ''}${capabilities.hasPose ? ' · 姿态' : ''}`}</p>
    <div className="capability-list">{targets.map(target => <div key={target.id}>
      <span>{target.id}<small>{target.kind === 'parameter' ? '参数' : '表情'}{target.signed ? ' · 双向' : ''}</small></span>
      <span>{driven(target.id) ? '可驱动' : '待映射'}</span>
    </div>)}</div>
  </details>;
}
