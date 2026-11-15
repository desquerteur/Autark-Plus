// Owns: the explicit Azure signing configuration for electron-builder 26.15.3.
// Never: embeds credentials, guesses a certificate identity, or disables updater signature checks.
const fs = require('node:fs');
const path = require('node:path');
const base = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')).build;
for (const key of ['AUTARK_SIGNING_ENDPOINT', 'AUTARK_SIGNING_ACCOUNT', 'AUTARK_SIGNING_PROFILE', 'AUTARK_SIGNING_PUBLISHER']) {
  if (!process.env[key]?.trim()) throw new Error(`Signing configuration missing: ${key}`);
}
if (!/^https:\/\/[a-z0-9]+\.codesigning\.azure\.net\/?$/.test(process.env.AUTARK_SIGNING_ENDPOINT)) {
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
