import crypto from "node:crypto";

/** Give packaged Electron executables their own build identity before signing.
 * Apple TN3179 requires main-executable UUIDs to be unique across applications.
 * Only LC_UUID payloads change; the source buffer and other load commands stay intact.
 */
export const patchMachOUuids = (source: Buffer, identity: string): Buffer => {
  if (!identity || source.length < 32) {
    throw new Error("Missing Mach-O identity or header");
  }
  const output = Buffer.from(source);
  const patchSlice = (offset: number, size: number) => {
    const end = offset + size;
    if (
      offset < 0 ||
      size < 32 ||
      end > output.length ||
      output.readUInt32LE(offset) !== 0xfe_ed_fa_cf
    ) {
      throw new Error("Unsupported or truncated 64-bit Mach-O slice");
    }
    const commandCount = output.readUInt32LE(offset + 16);
    const commandEnd = offset + 32 + output.readUInt32LE(offset + 20);
    if (commandEnd > end || commandCount > (commandEnd - offset - 32) / 8) {
      throw new Error("Invalid Mach-O load command bounds");
    }
    let cursor = offset + 32;
    let uuidOffset = -1;
    for (let index = 0; index < commandCount; index += 1) {
      if (cursor + 8 > commandEnd) {
        throw new Error("Truncated Mach-O load command");
      }
      const command = output.readUInt32LE(cursor);
      const length = output.readUInt32LE(cursor + 4);
      if (length < 8 || length % 8 !== 0 || cursor + length > commandEnd) {
        throw new Error("Invalid Mach-O load command size");
      }
      if (command === 0x1b) {
        if (length !== 24 || uuidOffset !== -1) {
          throw new Error("Invalid or duplicate Mach-O UUID command");
        }
        uuidOffset = cursor + 8;
      }
      cursor += length;
    }
    if (cursor !== commandEnd || uuidOffset === -1) {
      throw new Error("Mach-O UUID command is missing or malformed");
    }
    const uuid = crypto
      .createHash("sha256")
      .update(identity)
      .update("\0")
      .update(source.subarray(offset + 4, offset + 12))
      .update(source.subarray(uuidOffset, uuidOffset + 16))
      .digest()
      .subarray(0, 16);
    // RFC 9562 UUIDv8: application-specific, deterministic build identity.
    uuid[6] = ((uuid[6] ?? 0) % 16) + 0x80;
    uuid[8] = ((uuid[8] ?? 0) % 64) + 0x80;
    uuid.copy(output, uuidOffset);
  };
  if (output.readUInt32BE(0) === 0xca_fe_ba_be) {
    const count = output.readUInt32BE(4);
    const headerEnd = 8 + count * 20;
    if (count < 1 || headerEnd > output.length) {
      throw new Error("Invalid universal Mach-O header");
    }
    const slices: { offset: number; size: number }[] = [];
    for (let index = 0; index < count; index += 1) {
      const entry = 8 + index * 20;
      const offset = output.readUInt32BE(entry + 8);
      const size = output.readUInt32BE(entry + 12);
      if (
        offset < headerEnd ||
        slices.some(
          (slice) =>
            offset < slice.offset + slice.size && offset + size > slice.offset
        )
      ) {
        throw new Error("Overlapping universal Mach-O slices");
      }
      patchSlice(offset, size);
      slices.push({ offset, size });
    }
  } else {
    patchSlice(0, output.length);
  }
  return output;
};
