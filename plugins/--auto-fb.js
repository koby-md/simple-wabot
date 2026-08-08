import { fbdown } from 'btch-downloader'
import axios from 'axios'
import fs from 'fs'
import path from 'path'

const facebookRegex =
/https?:\/\/(?:www\.)?(?:facebook\.com|fb\.watch|fb\.com)\/\S+/i

export async function before(m, { conn }) {
  if (!m.text) return

  const match = m.text.match(facebookRegex)
  if (!match) return

  let filePath

  try {
    await m.react('⏳')
    await m.reply (wait)

    const res = await fbdown(match[0])

    const videoUrl = res.HD || res.Normal_video

    if (!videoUrl) return

    filePath = path.join(
      process.cwd(),
      `fb_${Date.now()}.mp4`
    )

    const response = await axios.get(videoUrl, {
      responseType: 'arraybuffer',
      maxRedirects: 10
    })

    fs.writeFileSync(filePath, response.data)

    await conn.sendFile(
      m.chat,
      filePath,
      'facebook.mp4',
      '🎥 Facebook Video',
      m
    )

    await m.react('✅')

  } catch (e) {
    console.error('FB ERROR:', e)
    m.react('❌')
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  }
}