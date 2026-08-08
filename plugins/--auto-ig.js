import fetch from 'node-fetch'
import fs from 'fs'
import path from 'path'

const instagramRegex =
  /https?:\/\/(?:www\.)?instagram\.com\/(?:reel|p|tv)\/[A-Za-z0-9_-]+/i

export async function before(m, { conn }) {
  if (!m.text) return

  const match = m.text.match(instagramRegex)
  if (!match) return

  const url = match[0]

  let filePath = path.join(
    process.cwd(),
    `tmp_instagram_${Date.now()}.mp4`
  )

  try {
    await m.react('⏳')
    await m.reply (wait)

    const response = await fetch(
      `https://koby-api.vercel.app/?url=${encodeURIComponent(url)}`
    )

    const res = await response.json()

    if (!res.status || !res.result?.length) {
      throw new Error('No media found')
    }

    const media = res.result[0]

    const fileExt =
      media.url.includes('.jpg') ||
      media.url.includes('.jpeg')
        ? 'jpg'
        : 'mp4'

    filePath = filePath.replace('.mp4', `.${fileExt}`)

    const buffer = await (await fetch(media.url)).arrayBuffer()

    fs.writeFileSync(filePath, Buffer.from(buffer))

    await conn.sendFile(
      m.chat,
      filePath,
      `instagram.${fileExt}`,
      '*✅ تم التنزيل تلقائياً من Instagram*',
      m
    )

    await m.react('✅')
  } catch (e) {
    console.error(e)
  } finally {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  }
}