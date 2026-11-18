// raiseDataFormat with a DATA_FORMAT one above the folder's (revisione 2026-11-18, G3).
import { describe, expect, it, vi } from 'vitest';
import { WORKSPACE_PATH } from '../src/store/store';
import { MemoryStore } from './helpers/memory-store';

vi.mock('../src/version', async (original) => ({
  ...(await original<typeof import('../src/version')>()),
  DATA_FORMAT: 2,
}));

describe('raiseDataFormat', () => {
  it('raises an older folder to DATA_FORMAT, keeping the other keys', async () => {
    const { raiseDataFormat } = await import('../src/workspace');
    const store = new MemoryStore();
    const workspace = {
      workspaceId: 'ws-1',
      name: 'Casa',
      schemaVersion: 1,
      minAppVersion: '0.1.0',
      createdAt: '2026-11-18T09:00:00.000Z',
      extra: 'kept',
    };
    await store.writeJsonAtomic(WORKSPACE_PATH, workspace);
    expect(await raiseDataFormat(store)).toBe('raised');
    expect(await store.readJson(WORKSPACE_PATH)).toEqual({ ...workspace, schemaVersion: 2 });
    expect(await raiseDataFormat(store)).toBe('unchanged');
  });
});
