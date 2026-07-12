import type { ServerCommand } from './messaging';

/**
 * Handler function for a specific command type.
 * Receives the command payload and an ack callback to confirm execution.
 */
export type CommandHandler<TPayload = unknown> = (
  payload: TPayload,
  requestId: string
) => void | Promise<void>;

/**
 * Registry of command handlers keyed by command type.
 * Used by MessagingClient to dispatch incoming server commands to the
 * appropriate intervention executor.
 *
 * @example
 * ```ts
 * const registry = new CommandRegistry();
 * registry.register('show_survey', (payload) => showSurvey(payload));
 * registry.register('reload_config', () => location.reload());
 *
 * const messaging = new MessagingClient({
 *   ...opts,
 *   onCommand: (cmd) => registry.execute(cmd),
 * });
 * ```
 */
export class CommandRegistry {
  private _handlers = new Map<string, CommandHandler>();

  /** Register a handler for a command type. Overwrites previous handler. */
  register<TPayload = unknown>(type: string, handler: CommandHandler<TPayload>): void {
    this._handlers.set(type, handler as CommandHandler);
  }

  /** Remove a handler by type. No-op if not registered. */
  unregister(type: string): void {
    this._handlers.delete(type);
  }

  /** Check if a handler is registered for the given type. */
  has(type: string): boolean {
    return this._handlers.has(type);
  }

  /**
   * Execute the handler for a command.
   * If no handler is registered, the command is silently dropped
   * and a warning is logged.
   */
  async execute(cmd: ServerCommand): Promise<void> {
    const handler = this._handlers.get(cmd.type);
    if (!handler) {
      console.warn(`[CommandRegistry] no handler for command type: ${cmd.type}`);
      return;
    }
    try {
      await handler(cmd.payload, cmd.requestId);
    } catch (err) {
      console.error(`[CommandRegistry] handler error for "${cmd.type}":`, err);
    }
  }

  /** Clear all registered handlers. */
  clear(): void {
    this._handlers.clear();
  }

  /** List all registered command types. */
  get registeredTypes(): string[] {
    return Array.from(this._handlers.keys());
  }
}