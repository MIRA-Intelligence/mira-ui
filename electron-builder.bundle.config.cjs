const path = require('node:path')

const platformDir = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'

module.exports = {
  appId: 'com.projectmira.miraui.bundle',
  productName: 'MIRA',
  directories: {
    output: 'release-bundle',
  },
  asar: true,
  files: [
    'dist/**',
    'dist-electron/**',
    'package.json',
  ],
  extraResources: [
    {
      from: path.join(__dirname, 'bundled-engine', platformDir),
      to: path.join('bundled-engine', platformDir),
      filter: ['**/*'],
    },
  ],
  mac: {
    identity: null,
    target: [
      'dmg',
      'zip',
    ],
    artifactName: '${productName}-bundle-${version}-${os}-${arch}.${ext}',
    category: 'public.app-category.developer-tools',
  },
  dmg: {
    contents: [
      { x: 164, y: 244, type: 'file' },
      { x: 456, y: 244, type: 'link', path: '/Applications' },
    ],
    window: {
      width: 620,
      height: 420,
    },
  },
  win: {
    target: [
      'nsis',
    ],
  },
  nsis: {
    artifactName: '${productName}-bundle-${version}-${os}-${arch}-setup.${ext}',
    oneClick: false,
    perMachine: true,
    allowElevation: true,
    allowToChangeInstallationDirectory: false,
    include: 'build/nsis/bundle-service.nsh',
  },
}
