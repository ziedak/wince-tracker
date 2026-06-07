/**
 * jest-environment-jsdom uses a vm sandbox where Node.js globals like
 * structuredClone are not automatically exposed to the window object.
 * fake-indexeddb v6 calls structuredClone() when cloning values on put().
 *
 * Polyfill it using Node's v8 serialize/deserialize, which is a faithful
 * implementation of the structured-clone algorithm.
 */
if (typeof globalThis.structuredClone === 'undefined') {
  const v8 = require('v8');
  globalThis.structuredClone = function structuredClone(value) {
    return v8.deserialize(v8.serialize(value));
  };
}
