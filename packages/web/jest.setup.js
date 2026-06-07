// Polyfill TextEncoder/TextDecoder for jsdom (not always exposed to the vm sandbox)
const util = require('util');
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = util.TextEncoder;
  globalThis.TextDecoder = util.TextDecoder;
}
