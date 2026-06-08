/**
 * ModesSettings — public stub
 *
 * The implementation lives in the local extension module.
 * This file re-exports it via the extension loader so that callers
 * in src/ never need to know where the real code lives.
 *
 * In a minimal build (no extension folder), the loader
 * returns a NullComponent and this panel simply renders nothing.
 */
export { ModesSettings as default } from '../../premium';
