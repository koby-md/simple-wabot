import { youtube } from 'btch-downloader'

const ytRegex =
/^https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=[\w-]+(?:\S*)?|youtu\.be\/[\w-]+(?:\S*)?)$/i

export async function before(m, { conn }) {
  if (!m.text) return

  const text = m.text.trim()

  // خاص الرسالة تكون رابط فقط
  if (!ytRegex.test(text)) return

  try {
    await m.react('⏳')

    const data = await youtube(text)

    if (!data?.mp4) return

    await conn.sendMessage(
      m.chat,
      {
        video: { url: data.mp4 },
        caption: `🎬 ${data.title}\n👤 ${data.author}`
      },
      { quoted: m }
    )

    await m.react('✅')

  } catch (e) {
    console.error(e)
  }
}