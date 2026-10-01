import type { AvatarCapabilities, ModelProfile, UISettings, UserCalibration } from '../contracts';
import { validateCalibration, validateModelProfile, validateUISettings } from './validation';

const STORES = ['models', 'calibrations', 'settings'] as const;
type Store = typeof STORES[number];

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
      request.onblocked = () => reject(new Error('配置数据库正被其他页面占用，请关闭旧页面后重试。'));
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
  async getModel(hash: string, capabilities?: AvatarCapabilities): Promise<ModelProfile | undefined> {
    const value = await this.get('models', hash);
    return value === undefined ? undefined : validateModelProfile(value, hash, capabilities);
  }
  async saveModel(profile: ModelProfile): Promise<void> { const value = validateModelProfile(profile); await this.put('models', value.modelHash, value); }
  async getCalibration(profileId = 'default'): Promise<UserCalibration | undefined> {
    const value = await this.get('calibrations', profileId);
    return value === undefined ? undefined : validateCalibration(value);
  }
  async saveCalibration(calibration: UserCalibration): Promise<void> { const value = validateCalibration(calibration); await this.put('calibrations', value.profileId, value); }
  async removeCalibration(profileId = 'default'): Promise<void> {
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('calibrations', 'readwrite');
      transaction.objectStore('calibrations').delete(profileId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('删除个人校准失败'));
      transaction.onabort = () => reject(transaction.error ?? new Error('删除个人校准已中断'));
    });
  }
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
