import fs from 'fs'
import path from 'path'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from 'ffmpeg-static'

ffmpeg.setFfmpegPath(ffmpegPath)

let handler = async (m, { conn }) => {
  const q = m.quoted || m
  const mime = q.mimetype || q.msg?.mimetype || ''

  if (!/audio|video/.test(mime)) {
    throw '> *_🌼 رد على فيديو أو أوديو واستعمل الأمر tomp3 🌼_*'
  }

  const tmpDir = './src/tmp'

  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true })
  }

  let inputPath
  let outputPath

  try {
    const media = await q.download()

    if (!media) throw 'فشل تحميل الملف'

    const ext = mime.split(';')[0].split('/')[1]

    inputPath = path.join(
      tmpDir,
      `${Date.now()}_${m.sender.split('@')[0]}.${ext}`
    )

    outputPath = inputPath.replace(/\.[^.]+$/, '.mp3')

    console.log('MIME:', mime)
    console.log('INPUT:', inputPath)
    console.log('OUTPUT:', outputPath)

    fs.writeFileSync(inputPath, media)

    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .audioCodec('libmp3lame')
        .format('mp3')
        .on('end', resolve)
        .on('error', reject)
        .save(outputPath)
    })

    if (!fs.existsSync(outputPath)) {
      throw 'فشل إنشاء ملف MP3'
    }

    await conn.sendMessage(
      m.chat,
      {
        audio: fs.readFileSync(outputPath),
        mimetype: 'audio/mpeg',
        fileName: 'output.mp3'
      },
      { quoted: m }
    )

  } catch (e) {
    console.error('TOMP3 ERROR:', e)
    m.reply(`❌ Error:\n${e}`)
  } finally {
    if (inputPath && fs.existsSync(inputPath)) {
      fs.unlinkSync(inputPath)
    }

    if (outputPath && fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath)
    }
  }
}

handler.help = ['tomp3']
handler.tags = ['tools']
handler.command = /^tomp3$/i

export default handler