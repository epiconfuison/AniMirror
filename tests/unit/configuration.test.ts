import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ConfigurationQueue } from '../../src/app/configuration';
import { DEFAULT_UI, type UserCalibration } from '../../src/core/contracts';
import { ProfileRepository } from '../../src/core/profiles';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const calibration: UserCalibration = { schemaVersion: 1, profileId: 'default', createdAt: '2026-09-30T00:00:00.000Z',
  neutral: { jawOpen: 0.1 }, ranges: { jawOpen: 0.5 }, neutralRotation: { x: 0, y: 0, z: 0 }, quality: { neutral: 1 } };

describe('configuration sequencing', () => {
  it('clears after an in-flight multi-store save and never resurrects the old calibration after reopening', async () => {
    const name = `clear-race-${crypto.randomUUID()}`, repository = new ProfileRepository(name), queue = new ConfigurationQueue();
    const reached = deferred(), resume = deferred(), operations: string[] = [];
    const saving = queue.run(queue.begin(), async () => {
      await repository.saveUI({ ...DEFAULT_UI, background: '#abcdef' });
      operations.push('saved UI'); reached.resolve(); await resume.promise;
      await repository.saveCalibration(calibration); operations.push('saved calibration');
    });
    await reached.promise;
    const clearing = queue.run(queue.begin(), async () => { await repository.clear(); operations.push('cleared'); });
    resume.resolve();
    expect(await saving).toBe(false); // The obsolete save must not update React state or report success.
    expect(await clearing).toBe(true);
    expect(operations).toEqual(['saved UI', 'saved calibration', 'cleared']);
    await repository.close();
    const reopened = new ProfileRepository(name);
    expect(await reopened.getUI()).toBeUndefined(); expect(await reopened.getCalibration()).toBeUndefined();
    await reopened.close();
  });

  it('cancels an import whose file read finishes after a clear, and skips superseded queued actions', async () => {
    const queue = new ConfigurationQueue(), events: string[] = [], hold = deferred(), started = deferred();
    const fileReadToken = queue.begin();
    const busy = queue.run(fileReadToken, async () => { started.resolve(); await hold.promise; events.push('first'); });
    await started.promise;
    const obsolete = queue.run(queue.begin(), async () => { events.push('obsolete save'); });
    const clear = queue.run(queue.begin(), async () => { events.push('clear'); });
    hold.resolve();
    expect(await busy).toBe(false); expect(await obsolete).toBe(false); expect(await clear).toBe(true);
    // A late file.text() completion retains its original token.
    expect(await queue.run(fileReadToken, async () => { events.push('late import'); })).toBe(false);
    expect(events).toEqual(['first', 'clear']);
  });

  it('keeps the queue usable after failed persistence and invalidates old restoration tokens', async () => {
    const queue = new ConfigurationQueue(), restoredAt = queue.token;
    const failed = queue.run(queue.begin(), async () => { throw new Error('storage denied'); });
    await expect(failed).rejects.toThrow('storage denied');
    expect(queue.isCurrent(restoredAt)).toBe(false);
    const result: string[] = [];
    expect(await queue.run(queue.begin(), async () => { result.push('retry'); })).toBe(true);
    expect(result).toEqual(['retry']);
  });
});
