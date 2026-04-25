const path = require('node:path')

const platformDir = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'

module.exports = {
  appId: 'com.projectmira.miraui.bundle',
  productName: 'MiraUI-bundle',
  directories: {
    output: 'release-bundle',
  },
  asar: true,
  extraResources: [
    {
      from: path.join(__dirname, 'bundled-engine', platformDir),
      to: 'bundled-engine',
      filter: ['**/*'],
    },
  ],
  mac: {
    identity: null,
    target: [
      'dmg',
      'zip',
    ],
    artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
    category: 'public.app-category.developer-tools',
  },
  win: {
    target: [
      'nsis',
      'portable',
    ],
  },
  nsis: {
    artifactName: '${productName}-${version}-${os}-${arch}-setup.${ext}',
  },
  portable: {
    artifactName: '${productName}-${version}-${os}-${arch}-portable.${ext}',
  },
}
