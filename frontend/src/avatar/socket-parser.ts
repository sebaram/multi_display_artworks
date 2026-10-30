import { Decoder as SocketDecoder, Encoder } from 'socket.io-parser';
/** Each populated humanoid contributes one binary attachment to room_state.
 * Keep a bound: beyond64 attachments a future packed/chunked snapshot is needed. */
class AvatarDecoder extends SocketDecoder {
  constructor() { super({ maxAttachments: 64 }); }
}
export const avatarSocketParser = { Decoder: AvatarDecoder, Encoder };
