import mapping from './mangled-names.generated';

const mappingTable: Record<string, string> = mapping as Record<string, string>;
const mangledValues = new Set(Object.values(mappingTable));

export function manglePayload<T extends Record<string, any>>(
  payload: T,
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of Object.keys(payload)) {
    const mapped = mappingTable[k];
    if (mapped !== undefined) {
      out[mapped] = payload[k];
    } else {
      if (mangledValues.has(k)) {
        console.warn(
          `[wince] manglePayload: key "${k}" collides with a mangled output key and will be silently overwritten on the receiver.`,
        );
      }
      out[k] = payload[k];
    }
  }
  return out;
}

export default manglePayload;
