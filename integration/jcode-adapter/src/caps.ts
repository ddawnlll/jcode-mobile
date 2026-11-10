/**
 * Adapter capability vocabulary (single source).
 *
 * `hello_ok`, `server_info`, `/info`, and the per-attachment `attached` frame
 * all advertise this list. Keeping one definition prevents capability drift
 * between the handshake and the attachment, where a client gating on an
 * attachment-only capability would otherwise never see it.
 */
export const ADAPTER_CAPABILITIES = [
  'mobile_continuation',
  'bounded_history',
  'identity_fencing',
  'delivery_receipts',
  'soft_interrupt_ids',
  'todo_state',
  'file_read',
  'archive_restore',
  'models',
  'directory_browse',
  'directory_create',
  'session_config',
  'context_snapshot',
  'image_input',
  'changes',
  'message_full_read',
] as const;
