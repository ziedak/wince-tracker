import { mountCart } from '../cart';


describe('mountCart', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('forwards wince:cart CustomEvent detail to tracker', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountCart(tracker);

    const detail = { action: 'add', product_id: 'SKU-1', price: 9.99 };
    document.dispatchEvent(new CustomEvent('wince:cart', { detail }));

    expect(tracker.track).toHaveBeenCalledTimes(1);
    expect(tracker.track).toHaveBeenCalledWith('$cart_add', expect.objectContaining({ product_id: 'SKU-1', price: 9.99 }));

    cleanup();
  });
});
