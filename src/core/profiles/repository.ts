import type { ModelCapabilities, ModelProfile, UISettings, UserCalibration } from '../contracts';
import { driveTargets } from '../adapters/capabilities';
import { validateCalibration, validateModelProfile, validateUISettings } from './validation';

const STORES = ['models', 'calibrations', 'settings'] as const;
type Store = typeof STORES[number];

export interface ProfileRestore {
  profile: ModelProfile;
  /** Mappings the current model cannot drive; they stay out of the live profile. */
  droppedMappings: number;
  /** True when a version 1 / legacy-key record was migrated in place. */
  migrated: boolean;
}

/**
 * Drop mappings whose target the loaded model does not expose. Keeping them would make
 * an old profile unusable after a model update, while dropping them silently is equally
 * wrong - callers report `droppedMappings`.
 */
export function fitProfileToCapabilities(profile: ModelProfile, capabilities?: ModelCapabilities): { profile: ModelProfile; dropped: number } {
  if (!capabilities || profile.format !== capabilities.format) return { profile, dropped: 0 };
  const targets = new Set(driveTargets(capabilities).map((target) => target.id));
  const mappings = profile.mappings.filter((mapping) => targets.has(mapping.target));
  return { profile: mappings.length === profile.mappings.length ? profile : { ...profile, mappings }, dropped: profile.mappings.length - mappings.length };
}

/** A VRM profile must never be applied to a Live2D model, or the other way round. */
function ensureFormat(profile: ModelProfile, assetId: string, capabilities?: ModelCapabilities): void {
  if (capabilities && capabilities.format !== profile.format) {
    throw new Error(`配置属于 ${profile.format} 模型（${assetId}），与当前 ${capabilities.format} 模型不匹配`);
  }
}

/** IndexedDB holds only configuration; model files and camera images are never persisted. */
export class ProfileRepository {
  private database?: Promise<IDBDatabase>;
  constructor(private readonly databaseName = 'ar-capture-v1') {}
  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    this.database = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('此浏览器无法使用 IndexedDB；配置仍可通过 JSON 导出。')); return; }
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        for (const store of STORES) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => { database.close(); this.database = undefined; };
        resolve(database);
      };
      request.onerror = () => reject(new Error(`本地配置数据库无法打开：${request.error?.message ?? '未知错误'}`));
      request.onblocked = () => reject(new Error('配置正被其他页面占用，请关闭旧页面后重试。'));
    });
    void this.database.catch(() => { this.database = undefined; });
    return this.database;
  }
  private async get(store: Store, key: string): Promise<unknown> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(store, 'readonly');
      const request = transaction.objectStore(store).get(key);
      transaction.oncomplete = () => resolve(request.result as unknown);
      transaction.onerror = () => reject(transaction.error ?? new Error('读取本地配置失败'));
      transaction.onabort = () => reject(transaction.error ?? new Error('读取本地配置已中断'));
    });
  }
  private async put(store: Store, key: string, value: unknown): Promise<void> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(store, 'readwrite');
      transaction.objectStore(store).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('保存失败；请检查浏览器存储权限或导出 JSON'));
      transaction.onabort = () => reject(transaction.error ?? new Error('保存本地配置已中断'));
    });
  }
  private async remove(store: Store, key: string): Promise<void> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(store, 'readwrite');
      transaction.objectStore(store).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('删除本地记录失败'));
      transaction.onabort = () => reject(transaction.error ?? new Error('删除本地记录已中断'));
    });
  }

  /**
   * Restore the profile for a model identity (`<format>:<hash>`). Version 1 records used
   * a bare SHA-256 key without a format; they are migrated to the new key on read.
   */
  async restoreModel(assetId: string, capabilities?: ModelCapabilities): Promise<ProfileRestore | undefined> {
    const direct = await this.get('models', assetId);
    if (direct !== undefined) {
      // Structural validation keeps a stored record blamed for its own damage; targets the
      // current model cannot drive are dropped afterwards instead of failing the restore.
      const stored = validateModelProfile(direct, assetId);
      ensureFormat(stored, assetId, capabilities);
      const { profile, dropped } = fitProfileToCapabilities(stored, capabilities);
      return { profile, droppedMappings: dropped, migrated: false };
    }
    if (!assetId.startsWith('vrm:')) return undefined;
    const legacyKey = assetId.slice(4);
    const legacy = await this.get('models', legacyKey);
    if (legacy === undefined) return undefined;
    const migrated = { ...validateModelProfile(legacy, legacyKey), modelHash: assetId };
    ensureFormat(migrated, assetId, capabilities);
    const { profile, dropped } = fitProfileToCapabilities(migrated, capabilities);
    await this.saveModel(profile);
    await this.remove('models', legacyKey);
    return { profile, droppedMappings: dropped, migrated: true };
  }

  async getModel(hash: string, capabilities?: ModelCapabilities): Promise<ModelProfile | undefined> {
    return (await this.restoreModel(hash, capabilities))?.profile;
  }
  async saveModel(profile: ModelProfile): Promise<void> { const value = validateModelProfile(profile); await this.put('models', value.modelHash, value); }
  async getCalibration(profileId = 'default'): Promise<UserCalibration | undefined> {
    const value = await this.get('calibrations', profileId);
    return value === undefined ? undefined : validateCalibration(value);
  }
  async saveCalibration(calibration: UserCalibration): Promise<void> { const value = validateCalibration(calibration); await this.put('calibrations', value.profileId, value); }
  async removeCalibration(profileId = 'default'): Promise<void> { await this.remove('calibrations', profileId); }
  async getUI(): Promise<UISettings | undefined> { const value = await this.get('settings', 'ui'); return value === undefined ? undefined : validateUISettings(value); }
  async saveUI(settings: UISettings): Promise<void> { await this.put('settings', 'ui', validateUISettings(settings)); }
  async clear(): Promise<void> {
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([...STORES], 'readwrite');
      for (const store of STORES) transaction.objectStore(store).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('清除本地配置失败'));
      transaction.onabort = () => reject(transaction.error ?? new Error('清除本地配置已中断'));
    });
  }
  async close(): Promise<void> { if (this.database) (await this.database).close(); this.database = undefined; }
}
