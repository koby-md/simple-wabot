import crypto from "crypto"
import axios from "axios"

class SaveTube {
  constructor() {
    this.ky = 'C5D58EF67A7584E4A29F6C35BBC4EB12'
    this.m = /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=|embed\/|v\/|shorts\/)?([a-zA-Z0-9_-]{11})/

    this.is = axios.create({
      headers: {
        'content-type': 'application/json',
        'origin': 'https://yt.savetube.me',
        'user-agent': 'Mozilla/5.0'
      }
    })
  }

  async decrypt(enc) {
    const buf = Buffer.from(enc, 'base64')
    const key = Buffer.from(this.ky, 'hex')
    const iv = buf.slice(0, 16)
    const data = buf.slice(16)

    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv)

    const decrypted = Buffer.concat([
      decipher.update(data),
      decipher.final()
    ])

    return JSON.parse(decrypted.toString())
  }

  async getCdn() {
    const res = await this.is.get("https://media.savetube.vip/api/random-cdn")
    return res.data.cdn
  }

  async download(url) {
    const id = url.match(this.m)?.[1]
    if (!id) throw new Error('Invalid YouTube URL')

    const cdn = await this.getCdn()

    const info = await this.is.post(
      `https://${cdn}/v2/info`,
      { url: `https://www.youtube.com/watch?v=${id}` }
    )

    const dec = await this.decrypt(info.data.data)

    const dl = await this.is.post(
      `https://${cdn}/download`,
      {
        id,
        downloadType: 'audio',
        quality: '128',
        key: dec.key
      }
    )

    return {
      title: dec.title,
      download: dl.data.data.downloadUrl
    }
  }
}


// 🔒 anti double trigger cache
const running = new Set()

let handler = async (m, { conn, text }) => {
  if (!text) throw '✳️ .ytmp3 <youtube url>'

  // منع التكرار
  if (running.has(m.key.id)) return
  running.add(m.key.id)

  try {
    await m.react('⏳')
    await m.reply (wait)

    const st = new SaveTube()
    const res = await st.download(text)

    await conn.sendMessage(
      m.chat,
      {
        audio: { url: res.download },
        mimetype: 'audio/mpeg',
        fileName: `${res.title}.mp3`
      },
      { quoted: m }
    )

    await m.react('✅')

  } catch (e) {
    console.error(e)
    m.reply('❌ Error: ' + (e.message || e))
  } finally {
    running.delete(m.key.id)
  }
}

handler.command = ['ytmp3']
handler.tags = ['downloader']
handler.help = ['ytmp3 <url>']

export default handler