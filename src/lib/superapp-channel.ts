/**
 * Name of the JS channel the super-app shell exposes to its mini apps.
 *
 * Shared by the client hand-off and the server log, and kept apart from
 * `superapp-bridge` so the server can name it without pulling in client code.
 */
export const CHANNEL_NAME = process.env.NEXT_PUBLIC_SUPERAPP_CHANNEL || 'MyJsChannel';
