import type * as SQLiteModule from '../index';

jest.mock('expo/devtools', () => ({
  getDevToolsPluginClientAsync: jest.fn(),
}));

class MockWorker {
  static instances: MockWorker[] = [];
  private listeners = new Map<string, ((event: { data?: { type?: string } }) => void)[]>();
  postMessage = jest.fn((message?: { type?: string }) => {
    if (message?.type !== 'shutdown') {
      return;
    }
    const handlers = [...(this.listeners.get('message') ?? [])];
    for (const handler of handlers) {
      handler({ data: { type: 'workerShutdown' } });
    }
  }) as jest.Mock;
  addEventListener = jest.fn(
    (type: string, handler: (event: { data?: { type?: string } }) => void) => {
      const list = this.listeners.get(type) ?? [];
      list.push(handler);
      this.listeners.set(type, list);
    }
  );
  removeEventListener = jest.fn(
    (type: string, handler: (event: { data?: { type?: string } }) => void) => {
      const list = this.listeners.get(type) ?? [];
      this.listeners.set(
        type,
        list.filter((item) => item !== handler)
      );
    }
  );
  terminate = jest.fn();
  constructor() {
    MockWorker.instances.push(this);
  }
}

const workerStartHandle = Symbol.for('expo-sqlite.webWorkerStart');

// The Node project also runs `.web` tests to cover server rendering, where there is no worker.
const describeWeb = typeof window !== 'undefined' ? describe : describe.skip;
const describeServer = typeof window === 'undefined' ? describe : describe.skip;

describeWeb('Configuring web', () => {
  let SQLite: typeof SQLiteModule;

  beforeEach(() => {
    MockWorker.instances = [];
    (globalThis as any).Worker = MockWorker;
    // `registerWebModule` caches the instance globally, which would keep the worker from the previous test.
    delete (globalThis as any).expo?.modules?.SQLiteModule;
    jest.isolateModules(() => {
      SQLite = require('../index');
    });
  });

  afterEach(() => {
    const globals = globalThis as typeof globalThis & {
      [workerStartHandle]?: ReturnType<typeof setTimeout>;
    };
    if (globals[workerStartHandle] != null) {
      clearTimeout(globals[workerStartHandle]);
      delete globals[workerStartHandle];
    }
    delete (globalThis as any).Worker;
  });

  async function nextTurnAsync(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function startWorkerAsync(): Promise<MockWorker> {
    SQLite.openDatabaseAsync(':memory:').catch(() => {});
    for (let i = 0; i < 20 && MockWorker.instances.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(MockWorker.instances).toHaveLength(1);
    return MockWorker.instances[0]!;
  }

  it('should start the worker on the next turn', async () => {
    expect(MockWorker.instances).toHaveLength(0);
    await nextTurnAsync();
    expect(MockWorker.instances).toHaveLength(1);
    const started = MockWorker.instances[0]!;
    expect(started.postMessage.mock.calls[0][0]).toEqual({ type: 'configure', data: {} });
    expect(started.postMessage.mock.calls[1][0]).toEqual({ type: 'init' });
  });

  it('should use a wasm url configured before the worker starts', async () => {
    SQLite.configureWeb({ wasmURL: '/sqlite/wa-sqlite-fts.wasm' });
    await nextTurnAsync();
    expect(MockWorker.instances).toHaveLength(1);
    expect(MockWorker.instances[0]!.postMessage.mock.calls[0][0]).toEqual({
      type: 'configure',
      data: { wasmURL: '/sqlite/wa-sqlite-fts.wasm' },
    });
  });

  it('should close the preloaded worker before loading a new wasm url', async () => {
    await nextTurnAsync();
    expect(MockWorker.instances).toHaveLength(1);
    const first = MockWorker.instances[0]!;
    SQLite.configureWeb({ wasmURL: '/sqlite/wa-sqlite-fts.wasm' });
    expect(first.postMessage.mock.calls.map((call) => call[0].type)).toContain('shutdown');
    expect(first.terminate).toHaveBeenCalledTimes(1);
    await nextTurnAsync();
    expect(MockWorker.instances).toHaveLength(2);
    expect(MockWorker.instances[1]!.postMessage.mock.calls[0][0]).toEqual({
      type: 'configure',
      data: { wasmURL: '/sqlite/wa-sqlite-fts.wasm' },
    });
    expect(MockWorker.instances[1]!.postMessage.mock.calls[1][0].type).toBe('init');
  });

  it('should configure the worker with no options by default', async () => {
    const worker = await startWorkerAsync();
    expect(worker.postMessage.mock.calls[0][0]).toEqual({ type: 'configure', data: {} });
  });

  it('should configure the worker with the custom wasm url before any request', async () => {
    SQLite.configureWeb({ wasmURL: '/sqlite/wa-sqlite-fts.wasm' });
    const worker = await startWorkerAsync();
    expect(worker.postMessage.mock.calls[0][0]).toEqual({
      type: 'configure',
      data: { wasmURL: '/sqlite/wa-sqlite-fts.wasm' },
    });
    expect(worker.postMessage.mock.calls[1][0].type).toBe('init');
    expect(worker.postMessage.mock.calls[2][0].type).toBe('open');
  });

  it('should use the options from the last call when called more than once', async () => {
    SQLite.configureWeb({ wasmURL: '/first.wasm' });
    SQLite.configureWeb({ wasmURL: '/second.wasm' });
    const worker = await startWorkerAsync();
    expect(worker.postMessage.mock.calls[0][0].data.wasmURL).toBe('/second.wasm');
  });

  it('should fall back to the default wasm when wasmURL is omitted', async () => {
    SQLite.configureWeb({ wasmURL: '/first.wasm' });
    SQLite.configureWeb({});
    const worker = await startWorkerAsync();
    expect(worker.postMessage.mock.calls[0][0].data.wasmURL).toBeUndefined();
  });

  it('should allow the same options after a database is opened', async () => {
    SQLite.configureWeb({ wasmURL: '/sqlite/wa-sqlite-fts.wasm' });
    await startWorkerAsync();
    expect(() => SQLite.configureWeb({ wasmURL: '/sqlite/wa-sqlite-fts.wasm' })).not.toThrow();
  });

  it('should throw when the wasm url changes after a database is opened', async () => {
    await startWorkerAsync();
    expect(() => SQLite.configureWeb({ wasmURL: '/late.wasm' })).toThrow(/reload/);
  });
});

describeServer('Configuring web on the server', () => {
  it('should do nothing when rendering on the server', () => {
    const SQLite: typeof SQLiteModule = require('../index');
    expect(() => SQLite.configureWeb({ wasmURL: '/sqlite/wa-sqlite-fts.wasm' })).not.toThrow();
  });
});
