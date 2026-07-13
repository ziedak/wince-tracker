import { CommandRegistry } from '../src/lib/commandRegistry.js';

// ---------------------------------------------------------------------------
// CommandRegistry
// ---------------------------------------------------------------------------

describe('CommandRegistry', () => {
  it('registers and executes a handler', async () => {
    const registry = new CommandRegistry();
    const received: string[] = [];

    registry.register<string>('show_survey', (payload) => {
      received.push(payload as string);
    });

    await registry.execute({
      type: 'show_survey',
      payload: 'survey-123',
      requestId: 'req-1'
    });

    expect(received).toEqual(['survey-123']);
  });

  it('supports async handlers', async () => {
    const registry = new CommandRegistry();
    let resolved = false;

    registry.register('async_cmd', async () => {
      await new Promise((r) => setTimeout(r, 10));
      resolved = true;
    });

    await registry.execute({
      type: 'async_cmd',
      payload: null,
      requestId: 'req-2'
    });

    expect(resolved).toBe(true);
  });

  it('warns when no handler is registered', async () => {
    const registry = new CommandRegistry();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {/**/});

    await registry.execute({
      type: 'unknown_cmd',
      payload: null,
      requestId: 'req-3'
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('no handler for command type: unknown_cmd')
    );
    warnSpy.mockRestore();
  });

  it('catches handler errors and logs them', async () => {
    const registry = new CommandRegistry();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {/**/});

    registry.register('failing_cmd', () => {
      throw new Error('handler exploded');
    });

    await registry.execute({
      type: 'failing_cmd',
      payload: null,
      requestId: 'req-4'
    });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('handler error for "failing_cmd"'),
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });

  it('unregisters a handler', async () => {
    const registry = new CommandRegistry();
    const handler = jest.fn();
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {/**/});

    registry.register('test_cmd', handler);
    expect(registry.has('test_cmd')).toBe(true);

    registry.unregister('test_cmd');
    expect(registry.has('test_cmd')).toBe(false);

    await registry.execute({
      type: 'test_cmd',
      payload: null,
      requestId: 'req-5'
    });

    warnSpy.mockRestore();
    expect(handler).not.toHaveBeenCalled();
  });

  it('overwrites previous handler on re-register', async () => {
    const registry = new CommandRegistry();
    const handler1 = jest.fn();
    const handler2 = jest.fn();

    registry.register('cmd', handler1);
    registry.register('cmd', handler2);

    await registry.execute({
      type: 'cmd',
      payload: null,
      requestId: 'req-6'
    });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it('clears all handlers', () => {
    const registry = new CommandRegistry();
    registry.register('cmd1', () => {
      /**/
    });
    registry.register('cmd2', () => {
      /**/
    });

    registry.clear();

    expect(registry.registeredTypes).toHaveLength(0);
  });

  it('lists registered types', () => {
    const registry = new CommandRegistry();
    registry.register('cmd_a', () => {
      /**/
    });
    registry.register('cmd_b', () => {
      /**/
    });

    expect(registry.registeredTypes.sort()).toEqual(['cmd_a', 'cmd_b']);
  });
});
