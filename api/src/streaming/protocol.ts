/**
 * streaming/protocol.ts — the canvas media-channel wire schemas (B17 port). Pure zod.
 *
 * These are the ONLY message shapes allowed across the socket: frames + viewport + input +
 * keepalive. NOT an API payload (FIXED-2 carve-out, ch03 §3.7): no REST/JSON resource ever
 * crosses this channel — it is a screen-share, not API transport.
 */
import { z } from 'zod';

const ModifiersSchema = z.object({
  alt: z.boolean().optional(),
  ctrl: z.boolean().optional(),
  meta: z.boolean().optional(),
  shift: z.boolean().optional(),
}).optional();

export const FrameMessageSchema = z.object({
  type: z.literal('frame'),
  seq: z.number(),
  jpegBase64: z.string(),
});

export const ViewportMessageSchema = z.object({
  type: z.literal('viewport'),
  width: z.number(),
  height: z.number(),
});

export const ErrorMessageSchema = z.object({
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
});

export const PongMessageSchema = z.object({
  type: z.literal('pong'),
  t: z.number(),
});

export const ServerMessageSchema = z.discriminatedUnion('type', [
  FrameMessageSchema,
  ViewportMessageSchema,
  ErrorMessageSchema,
  PongMessageSchema,
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export const MouseMessageSchema = z.object({
  type: z.literal('mouse'),
  x: z.number(),
  y: z.number(),
  button: z.enum(['left', 'middle', 'right', 'none']).optional(),
  action: z.enum(['down', 'up', 'move', 'wheel']),
  deltaX: z.number().optional(),
  deltaY: z.number().optional(),
  modifiers: ModifiersSchema,
});

export const KeyMessageSchema = z.object({
  type: z.literal('key'),
  code: z.string(),
  key: z.string(),
  action: z.enum(['down', 'up']),
  modifiers: ModifiersSchema,
});

export const FrameAckMessageSchema = z.object({
  type: z.literal('frame_ack'),
  seq: z.number(),
});

export const PingMessageSchema = z.object({
  type: z.literal('ping'),
  t: z.number(),
});

export const ClientMessageSchema = z.discriminatedUnion('type', [
  MouseMessageSchema,
  KeyMessageSchema,
  FrameAckMessageSchema,
  PingMessageSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type MouseMessage = z.infer<typeof MouseMessageSchema>;
export type KeyMessage = z.infer<typeof KeyMessageSchema>;

export type ModifierBits = number;

export function modifiersToBits(m: { alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean } | undefined): ModifierBits {
  if (!m) return 0;
  let bits = 0;
  if (m.alt) bits |= 1;
  if (m.ctrl) bits |= 2;
  if (m.meta) bits |= 4;
  if (m.shift) bits |= 8;
  return bits;
}
