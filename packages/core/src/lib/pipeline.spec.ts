import { Pipeline } from './pipeline';

interface Ev { type: string; value?: number; enriched?: boolean }

describe('Pipeline', () => {
  it('passes event through with no hooks', () => {
    const p = new Pipeline<Ev>();
    expect(p.run({ type: 'click' })).toEqual({ type: 'click' });
  });

  it('runs hooks in registration order', () => {
    const order: number[] = [];
    const p = new Pipeline<Ev>()
      .use((e) => { order.push(1); return e; })
      .use((e) => { order.push(2); return e; })
      .use((e) => { order.push(3); return e; });

    p.run({ type: 'ev' });
    expect(order).toEqual([1, 2, 3]);
  });

  it('hook can enrich the event (return new object)', () => {
    const p = new Pipeline<Ev>()
      .use((e) => ({ ...e, enriched: true }));

    expect(p.run({ type: 'click' })).toEqual({ type: 'click', enriched: true });
  });

  it('hook returning null drops the event', () => {
    const p = new Pipeline<Ev>()
      .use(() => null);

    expect(p.run({ type: 'click' })).toBeUndefined();
  });

  it('hook returning undefined drops the event', () => {
    const p = new Pipeline<Ev>()
      .use(() => undefined);

    expect(p.run({ type: 'click' })).toBeUndefined();
  });

  it('subsequent hooks are not called after a drop', () => {
    const spy = jest.fn((e: Ev) => e);
    const p = new Pipeline<Ev>()
      .use(() => null)
      .use(spy);

    p.run({ type: 'click' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('first hook passes, second drops', () => {
    const p = new Pipeline<Ev>()
      .use((e) => ({ ...e, value: 1 }))
      .use(() => null);

    expect(p.run({ type: 'click' })).toBeUndefined();
  });

  it('size reflects registered hook count', () => {
    const p = new Pipeline<Ev>()
      .use((e) => e)
      .use((e) => e);

    expect(p.size).toBe(2);
  });

  it('supports method chaining on use()', () => {
    const p = new Pipeline<Ev>();
    expect(p.use((e) => e)).toBe(p);
  });
});
