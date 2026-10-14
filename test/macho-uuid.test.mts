import assert from "node:assert/strict";
import test from "node:test";

import { patchMachOUuids } from "../scripts/macho-uuid.mjs";

// Minimal 64-bit Mach-O fixture from Apple's loader.h: 32-byte header,
// one 24-byte LC_UUID command, then unrelated payload bytes.
const thin = (cpu = 0x01_00_00_0c) => {
  const bytes = Buffer.alloc(72, 0);
  bytes.writeUInt32LE(0xfe_ed_fa_cf, 0);
  bytes.writeUInt32LE(cpu, 4);
  bytes.writeUInt32LE(1, 16);
  bytes.writeUInt32LE(24, 20);
  bytes.writeUInt32LE(0x1b, 32);
  bytes.writeUInt32LE(24, 36);
  bytes.fill(0x11, 40, 56);
  bytes.fill(0x5a, 56);
  return bytes;
};

test("packaging changes only build UUID bytes and separates application identities", () => {
  const original = thin();
  const patched = patchMachOUuids(original, "com.keyharbor.app:build-one");
  assert.deepEqual(patched.subarray(0, 40), original.subarray(0, 40));
  assert.deepEqual(patched.subarray(56), Buffer.alloc(16, 0x5a));
  assert.deepEqual(original.subarray(40, 56), Buffer.alloc(16, 0x11));
  assert.notDeepEqual(patched.subarray(40, 56), Buffer.alloc(16, 0x11));
  assert.notDeepEqual(
    patched.subarray(40, 56),
    patchMachOUuids(original, "com.localkeys.app:build-one").subarray(40, 56)
  );
});

test("universal macOS packaging assigns a UUID to each architecture without touching headers or payloads", () => {
  const source = Buffer.alloc(208);
  source.writeUInt32BE(0xca_fe_ba_be, 0);
  source.writeUInt32BE(2, 4);
  source.writeUInt32BE(64, 16);
  source.writeUInt32BE(72, 20);
  source.writeUInt32BE(136, 36);
  source.writeUInt32BE(72, 40);
  thin().copy(source, 64);
  thin(0x01_00_00_07).copy(source, 136);
  const result = patchMachOUuids(source, "com.keyharbor.app:universal-build");
  assert.deepEqual(result.subarray(0, 104), source.subarray(0, 104));
  assert.deepEqual(result.subarray(120, 176), source.subarray(120, 176));
  assert.deepEqual(result.subarray(192), source.subarray(192));
  assert.notDeepEqual(result.subarray(104, 120), Buffer.alloc(16, 0x11));
  assert.notDeepEqual(result.subarray(176, 192), Buffer.alloc(16, 0x11));
  assert.notDeepEqual(result.subarray(104, 120), result.subarray(176, 192));
});

test("malformed native artifacts fail before signing and leave their input intact", () => {
  const malformed = [
    Buffer.from("not a Mach-O"),
    thin().subarray(0, 50),
    thin(),
  ];
  malformed[2]?.writeUInt32LE(0, 32);
  for (const source of malformed) {
    const unchanged = Buffer.from(source);
    assert.throws(() =>
      patchMachOUuids(source, "com.keyharbor.app:invalid-build")
    );
    assert.deepEqual(source, unchanged);
  }
});
