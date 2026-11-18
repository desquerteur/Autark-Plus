// Owns: the explicit signing configuration for electron-builder 26.15.3 – Azure Artifact Signing, or (16.11.2026,
// AUTARK_WINDOWS_SIGNING=certum) a certificate in this PC's user store named by its thumbprint: Certum's SimplySign keeps
// the key on its virtual card, so such a build signs on the PC where SimplySign Desktop is signed in.
// Never: embeds credentials, guesses a certificate identity, or disables updater signature checks.
const fs = require('node:fs');
const path = require('node:path');
const base = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')).build;
const certum = process.env.AUTARK_WINDOWS_SIGNING === 'certum';
for (const key of certum ? ['AUTARK_SIGNING_THUMBPRINT', 'AUTARK_SIGNING_PUBLISHER'] : ['AUTARK_SIGNING_ENDPOINT', 'AUTARK_SIGNING_ACCOUNT', 'AUTARK_SIGNING_PROFILE', 'AUTARK_SIGNING_PUBLISHER']) {
  if (!process.env[key]?.trim()) throw new Error(`Signing configuration missing: ${key}`);
}
if (certum) {
  if (!/^[0-9A-Fa-f]{40}$/.test(process.env.AUTARK_SIGNING_THUMBPRINT.trim())) throw new Error('Expected the signing certificate SHA-1 thumbprint (40 hex characters).');
} else if (!/^https:\/\/[a-z0-9]+\.codesigning\.azure\.net\/?$/.test(process.env.AUTARK_SIGNING_ENDPOINT)) {
  throw new Error('Expected the certificate account regional Azure signing endpoint.');
}
module.exports = {
  ...base,
  forceCodeSigning: true,
  nsis: { ...base.nsis, include: path.resolve(__dirname, '../assets/installer.nsh') },
  win: {
    ...base.win,
    signAndEditExecutable: true,
    signExecutable: true,
    signExts: ['.dll', '.node'],
    verifyUpdateCodeSignature: true,
    signtoolOptions: {
      sign: './scripts/windows-signing.mjs',
      signingHashAlgorithms: ['sha256'],
      publisherName: process.env.AUTARK_SIGNING_PUBLISHER,
    },
  },
  afterSign: './scripts/windows-signing.mjs',
};
