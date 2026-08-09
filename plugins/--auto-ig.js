import fetch from 'node-fetch'
import fs from 'fs'
import path from 'path'

const instagramRegex =
  /https?:\/\/(?:www\.)?instagram\.com\/(?:reel|p|tv)\/[A-Za-z0-9_-]+/i

export async function before(m, { conn }) {
  if (!m.text) return

  const match = m.text.match(instagramRegex)
  if (!match) return

  const tmpDir = path.join(process.cwd(), 'tmp')
  const filePath = path.join(tmpDir, `ig_${Date.now()}.mp4`)

  try {
    await m.react('⏳')

    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true })
    }

    const api = await fetch(
      `https://koby-api.vercel.app/?url=${encodeURIComponent(match[0])}`
    )

    const json = await api.json()
    const videoUrl = json?.result?.[0]?.url

    if (!json.status || !videoUrl) {
      throw new Error(`No video URL: ${JSON.stringify(json)}`)
    }

    const video = await fetch(videoUrl)

    if (!video.ok) {
      throw new Error(`Video HTTP ${video.status}`)
    }

    const buffer = Buffer.from(await video.arrayBuffer())

    fs.writeFileSync(filePath, buffer)

    const fileBuffer = fs.readFileSync(filePath)

    await conn.sendMessage(
      m.chat,
      {
        video: fileBuffer,
        mimetype: 'video/mp4',
        caption: '✅ Instagram'
      },
      {
        quoted: m
      }
    )

    await m.react('✅')

  } catch (e) {
    console.error('[IG ERROR]', e)

    await m.react('❌')
    await m.reply(
      `❌ IG ERROR:\n${e.message || e}`
    )

  } finally {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath)
      } catch {}
    }
  }
}