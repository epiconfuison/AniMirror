/**
 * Shared data contracts. Nothing in this file may reference Three.js, VRM or Cubism
 * types: tracking, retargeting and configuration stay format agnostic and only know
 * about named drive targets.
 */
export const SCHEMA_VERSION = 2 as const;
export const PROFILE_SCHEMA_VERSION = 2 as const;

export type Rotation = { x: number; y: number; z: number }; // radians, anatomical left/right; preview mirror never changes data

export interface TrackingFrame {
  schemaVersion: 1; timestamp: number; faceDetected: boolean;
  rotation: Rotation; channels: Record<string, number>; inferenceMs: number;
}

/** Model formats the first version supports. Everything else is out of scope. */
export type ModelFormat = 'vrm' | 'live2d';

export interface ExpressionCapability {
  name: string; preset: boolean; bindCount: number; isBinary: boolean;
  overrideBlink: string; overrideMouth: string; overrideLookAt: string;
}

/** VRM-specific capability detail. Cubism parameter ids must never appear here. */
export interface VrmCapabilities {
  format: 'vrm';
  version: '0' | '1'; name: string;
  bones: { head: boolean; leftEye: boolean; rightEye: boolean };
  expressions: ExpressionCapability[]; morphTargets: string[]; missing: string[];
  level: 'basic' | 'face' | 'rich'; vertexCount: number;
}

export interface Live2DParameterCapability {
  id: string; label: string; group: string;
  min: number; max: number; default: number;
}

/** Live2D-specific capability detail read from the model's own parameters. */
export interface Live2DCapabilities {
  format: 'live2d'; name: string;
  parameters: Live2DParameterCapability[]; groups: Record<string, number>;
  expressionNames: string[]; hasPhysics: boolean; hasPose: boolean;
  textureCount: number; drawableCount: number; mocVersion: number;
  missing: string[]; level: 'basic' | 'face' | 'rich';
}

export type ModelCapabilities = VrmCapabilities | Live2DCapabilities;
/** @deprecated VRM-only alias kept because existing call sites and fixtures used this name. */
export type AvatarCapabilities = VrmCapabilities;

/** Stable identity (`<format>:<content hash>`) plus display metadata for the loaded model. */
export interface ModelAsset {
  assetId: string; name: string; format: ModelFormat; source: 'local';
  sizeBytes: number; entry: string;
}
export type AvatarAsset = ModelAsset;

export interface ChannelTuning { gain: number; deadZone: number; min: number; max: number; curve: number }

export interface MappingRule {
  id: string; input: string; target: string; weight: number; enabled: boolean;
  approximate: boolean; confirmed: boolean;
  /** Target accepts negative amounts (for example a Cubism parameter whose default sits mid-range). */
  signed?: boolean;
  /** Drive the target from `1 - channel`, for targets whose value grows as the channel falls. */
  invert?: boolean;
}

export interface ModelProfile {
  schemaVersion: 2; modelHash: string; modelName: string; format: ModelFormat;
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
  schemaVersion: 2; model?: ModelProfile; calibration?: UserCalibration; ui?: UISettings;
}

/** Single per-frame drive result: named target amounts, head rotation and tracking state. */
export interface DriveOutput { expressions: Record<string, number>; rotation: Rotation; tracking: 'live' | 'hold' | 'lost' }

export const DEFAULT_TUNING: ChannelTuning = { gain: 1, deadZone: 0.03, min: 0, max: 1, curve: 1 };
export const DEFAULT_UI: UISettings = { schemaVersion: 1, background: '#dce9e5', framing: 'half', mirror: true, showVideo: true };
export const ZERO_ROTATION: Rotation = { x: 0, y: 0, z: 0 };
