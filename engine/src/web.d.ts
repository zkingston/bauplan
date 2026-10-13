// The codec uses these web stream globals. Browsers and Node 18+ have them. This file declares
// them so that the engine compiles without the DOM lib.
declare class CompressionStream {
  constructor(format: 'deflate-raw');
}
declare class DecompressionStream {
  constructor(format: 'deflate-raw');
}
interface ByteStream {
  pipeThrough(t: CompressionStream | DecompressionStream): ByteStream;
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    cancel(): Promise<void>;
  };
}
declare class Blob {
  constructor(parts: Uint8Array[]);
  stream(): ByteStream;
}
