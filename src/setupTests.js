// Jest setup (loaded automatically by react-scripts before each test file).
// jest 27's jsdom environment doesn't expose TextEncoder/TextDecoder, which
// src/utils/nfcNdef.js uses to decode NDEF URI payloads. Bridge in Node's
// implementations (identical WHATWG API). Runtime (browser/WebView) always
// has them natively — this is test-environment-only.
const { TextEncoder, TextDecoder } = require('util');

if (typeof global.TextEncoder === 'undefined') global.TextEncoder = TextEncoder;
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = TextDecoder;
