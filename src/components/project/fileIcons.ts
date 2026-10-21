export function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'py':
    case 'sh':
    case 'js':
    case 'ts':
    case 'tsx':
    case 'jsx':
      return '📄'
    case 'json':
      return '⚙️'
    case 'csv':
    case 'tsv':
      return '📊'
    case 'pdf':
      return '📕'
    case 'zip':
    case 'gz':
    case 'tar':
      return '📦'
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
      return '🖼️'
    case 'md':
      return '📝'
    case 'log':
    case 'txt':
      return '🗒️'
    default:
      return '📄'
  }
}
