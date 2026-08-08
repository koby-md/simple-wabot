import axios from 'axios'

const tiktokRegex =
/^https?:\/\/(?:www\.)?(?:tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com)\/\S+$/i

export async function before(m, { conn }) {
  if (!m.text) return

  const text = m.text.trim()

  // خاص تكون الرسالة غير رابط
  if (!tiktokRegex.test(text)) return

  try {
    await m.react('⏳')
    await m.reply(wait)

    const params = new URLSearchParams()
    params.append('url', text)
    params.append('hd', '2')

    const { data } = await axios.post(
      'https://tikwm.com/api/',
      params,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Cookie: 'current_language=en',
          'User-Agent': 'Mozilla/5.0'
        }
      }
    )

    const res = data.data
    if (!res) return

    // ====== منشور صور ======
    if (Array.isArray(res.images) && res.images.length) {

      for (const img of res.images) {
        await conn.sendMessage(
          m.chat,
          {
            image: { url: img }
          },
          { quoted: m }
        )
      }

      if (res.music) {
        await conn.sendMessage(
          m.chat,
          {
            audio: { url: res.music },
            mimetype: 'audio/mpeg',
            ptt: false
          },
          { quoted: m }
        )
      }

      await m.react('✅')
      return
    }

    // ====== منشور فيديو ======
    if (res.play) {
      await conn.sendMessage(
        m.chat,
        {
          video: { url: res.play }
        },
        { quoted: m }
      )
    }

    await m.react('✅')

  } catch (e) {
    console.error(e)
  }
}