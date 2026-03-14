/**
 * Re-export safeJsonParse for testing.
 * The function lives in native-parser-bridge.ts but importing that module
 * directly pulls in the native addon which may not be available in test env.
 */
export { safeJsonParse } from "../native-parser-bridge.ts";
