/**
 * Ambient module declarations for native-STT dependencies that ship no types.
 * sherpa-onnx-node and vosk-koffi are accessed through `any`-typed wrappers in
 * SherpaStreamingSTT / VoskSTT, so a minimal `any` surface is sufficient — the
 * runtime config shapes are validated by the engines themselves.
 */

declare module 'sherpa-onnx-node' {
  export const OnlineRecognizer: any;
  export const OfflineRecognizer: any;
  export const readWave: any;
  export const writeWave: any;
  const _default: any;
  export default _default;
}

declare module 'unbzip2-stream' {
  const bz2: () => NodeJS.ReadWriteStream;
  export default bz2;
}
