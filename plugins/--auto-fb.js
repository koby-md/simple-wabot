import { fbdown } from 'btch-downloader'

const facebookRegex =
  /https?:\/\/(?:www\.)?(?:facebook\.com|fb\.watch|fb\.com)\/\S+/i

export async function before(m, { conn }) {
  if (!m.text) return

  const match = m.text.match(facebookRegex)
  if (!match) return

  try {
    await m.react('⏳')
    await m.reply(wait)

    const res = await fbdown(match[0])

    console.log('[FB] Result:', res)

    if (!res?.status) {
      throw new Error(`fbdown failed: ${JSON.stringify(res)}`)
    }

    const videoUrl = res.HD || res.Normal_video

    if (!videoUrl) {
      throw new Error(
        `لم يتم العثور على رابط الفيديو: ${JSON.stringify(res)}`
      )
    }

    console.log('[FB] Video URL:', videoUrl)

    await conn.sendMessage(
      m.chat,
      {
        video: {
          url: videoUrl
        },
        mimetype: 'video/mp4',
        caption: '🎥 Facebook Video'
      },
      {
        quoted: m
      }
    )

    await m.react('✅')

  } catch (e) {
    console.error('[FB ERROR FULL]:', e)

    let errorText = `Message: ${e?.message || String(e)}`

    if (e?.response) {
      errorText += `\nHTTP Status: ${e.response.status}`

      if (e.response.data) {
        try {
          errorText += `\nResponse: ${JSON.stringify(e.response.data)}`
        } catch {
          errorText += `\nResponse: ${String(e.response.data)}`
        }
      }
    }

    console.error(errorText)

    await m.react('❌')
    await m.reply(
      `❌ FB ERROR:\n\n${errorText}`.slice(0, 4000)
    )
  }
}