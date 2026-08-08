import {
  prepareWAMessageMedia,
  generateWAMessageFromContent
} from '@whiskeysockets/baileys'

import yts from 'yt-search'

function formatViews(views) {
  if (views >= 1000000) {
    return (views / 1000000).toFixed(1).replace('.0', '') + 'M'
  }

  if (views >= 1000) {
    return (views / 1000).toFixed(1).replace('.0', '') + 'K'
  }

  return views.toString()
}

let handler = async (m, { conn, text }) => {
  if (!text) throw '🛡 اكتب اسم الفيديو أو الأغنية'

  try {
    const search = await yts(text)
    await m.react('⏳')
    await m.reply (wait)
    if (!search.videos.length) {
      return m.reply('❌ لم يتم العثور على نتائج')
    }

    const v = search.videos[0]

    const media = await prepareWAMessageMedia(
      {
        image: { url: v.thumbnail }
      },
      {
        upload: conn.waUploadToServer
      }
    )

    const msg = generateWAMessageFromContent(
      m.chat,
      {
        viewOnceMessage: {
          message: {
            interactiveMessage: {
              header: {
                hasMediaAttachment: true,
                imageMessage: media.imageMessage,
                title: '🎬 YouTube KOBY 🧬'
              },

              body: {
                text:
`🎵 *${v.title}*

👤 Author: ${v.author.name}
⏱️ Duration: ${v.timestamp}
👁️ Views: ${formatViews(v.views)}

🔗 ${v.url}`
              },

              footer: {
                text: 'اختر أحد الخيارات'
              },

              nativeFlowMessage: {
                buttons: [
                  {
                    name: 'cta_copy',
                    buttonParamsJson: JSON.stringify({
                      display_text: '📋 Copy URL',
                      copy_code: v.url
                    })
                  },
                  {
                    name: 'cta_url',
                    buttonParamsJson: JSON.stringify({
                      display_text: '🌐 Open URL',
                      url: v.url,
                      merchant_url: v.url
                    })
                  },
                  {
                    name: 'quick_reply',
                    buttonParamsJson: JSON.stringify({
                      display_text: '📥 Download',
                      id: `.play ${v.url}`
                    })
                  }
                ]
              }
            }
          }
        }
      },
      {
        userJid: conn.user.jid,
        quoted: m
      }
    )
    await m.react('💡')
    await conn.relayMessage(
      m.chat,
      msg.message,
      { messageId: msg.key.id }
    )

  } catch (e) {
    console.error(e)
    m.reply('❌ حدث خطأ أثناء البحث')
  }
}

handler.help = ['yts <query>']
handler.tags = ['search']
handler.command = /^yts$/i

export default handler