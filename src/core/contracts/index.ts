export const SCHEMA_VERSION = 1 as const;
export type Rotation = { x: number; y: number; z: number }; // radians, anatomical left/right; preview mirror never changes data
export interface TrackingFrame {
  schemaVersion: 1; timestamp: number; faceDetected: boolean;
  rotation: Rotation; channels: Record<string, number>; inferenceMs: number;
}
export interface ExpressionCapability {
  name: string; preset: boolean; bindCount: number; isBinary: boolean;
  overrideBlink: string; overrideMouth: string; overrideLookAt: string;
}
export interface AvatarCapabilities {
  version: '0' | '1'; name: string; bones: { head: boolean; leftEye: boolean; rightEye: boolean };
  expressions: ExpressionCapability[]; morphTargets: string[]; missing: string[];
  level: 'basic' | 'face' | 'rich'; vertexCount: number;
}
export interface AvatarAsset {
  assetId: string; file: File; format: 'vrm'; source: 'local'; name: string;
}
export interface ChannelTuning { gain: number; deadZone: number; min: number; max: number; curve: number }
export interface MappingRule {
  id: string; input: string; target: string; weight: number; enabled: boolean;
  approximate: boolean; confirmed: boolean;
}
export interface ModelProfile {
  schemaVersion: 1; modelHash: string; modelName: string;
  mappings: MappingRule[]; tuning: Record<string, ChannelTuning>;
  headLimits: Rotation; headGain: number; smoothing: number; style: 'natural' | 'enhanced';
  eyeMode: 'expression' | 'off';
}
export interface UserCalibration {
  schemaVersion: 1; profileId: string; createdAt: string;
  neutral: Record<string, number>; ranges: Record<string, number>;
  neutralRotation: Rotation; quality: Record<string, number>;
}
export interface UISettings {
  schemaVersion: 1; background: string; framing: 'head' | 'half'; mirror: boolean; showVideo: boolean;
}
export interface ConfigBundle {
  schemaVersion: 1; model?: ModelProfile; calibration?: UserCalibration; ui?: UISettings;
}
export interface DriveOutput { expressions: Record<string, number>; rotation: Rotation; tracking: 'live' | 'hold' | 'lost' }
export const DEFAULT_TUNING: ChannelTuning = { gain: 1, deadZone: 0.03, min: 0, max: 1, curve: 1 };
export const DEFAULT_UI: UISettings = { schemaVersion: 1, background: '#dce9e5', framing: 'half', mirror: true, showVideo: true };
export const ZERO_ROTATION: Rotation = { x: 0, y: 0, z: 0 };
