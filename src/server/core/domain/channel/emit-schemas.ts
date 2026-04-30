import {mkdir, writeFile} from 'node:fs/promises'
import path from 'node:path'

import {channelJsonSchemaFiles} from './schemas.js'

export async function emitChannelJsonSchemas(outputDir = path.join(process.cwd(), 'docs', 'channel-schemas')): Promise<void> {
  await mkdir(outputDir, {recursive: true})

  await Promise.all(Object.entries(channelJsonSchemaFiles).map(([filename, schema]) => {
    const filePath = path.join(outputDir, filename)
    return writeFile(filePath, `${JSON.stringify(schema, null, 2)}\n`, 'utf8')
  }))
}

await emitChannelJsonSchemas()
