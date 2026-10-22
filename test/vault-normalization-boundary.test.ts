const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeVaultDataValue,
} = require("../src/modules/vault-normalization");

// eslint-disable-next-line sort-keys -- Preserve the encrypted legacy Vault field order.
const validLegacyVault = () => ({
  // eslint-disable-next-line sort-keys -- Preserve the encrypted legacy Vault field order.
  version: "1.0.0",
  // eslint-disable-next-line sort-keys -- Preserve the encrypted legacy Vault field order.
  legacySourceFingerprint: { vault: "missing", salt: "missing" },
  favorites: { projects: [], secrets: {} },
  projects: {},
});

test("Vault normalization preserves valid migration metadata and field order", () => {
  const normalized = normalizeVaultDataValue(validLegacyVault());

  assert.equal(normalized.needsFormatMigration, true);
  // eslint-disable-next-line sort-keys -- Preserve legacy metadata property order.
  assert.deepEqual(normalized.data.legacySourceFingerprint, {
    vault: "missing",
    salt: "missing",
  });
  assert.deepEqual(Object.keys(normalized.data), [
    "version",
    "legacySourceFingerprint",
    "favorites",
    "projects",
    "vaultFormatVersion",
  ]);
});

test("Vault normalization rejects malformed optional metadata", () => {
  assert.throws(
    () => normalizeVaultDataValue({ ...validLegacyVault(), version: {} }),
    { message: "Invalid Vault metadata" }
  );
  assert.throws(
    () =>
      normalizeVaultDataValue({
        ...validLegacyVault(),
        // eslint-disable-next-line sort-keys -- Preserve legacy metadata property order.
        legacySourceFingerprint: {
          vault: "missing",
          salt: "missing",
          extra: true,
        },
      }),
    { message: "Invalid Vault metadata" }
  );
});
