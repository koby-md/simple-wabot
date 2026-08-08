import axios from 'axios'
import {
  prepareWAMessageMedia,
  generateWAMessageFromContent
} from '@whiskeysockets/baileys'

let handler = async (m, { conn }) => {
  try {
    await m.react('⏳')
    // إذا كان متغير wait غير معرف كمتغير عام، يمكنك تغييره إلى نص مثل 'الرجاء الانتظار...'
    if (typeof wait !== 'undefined') await m.reply(wait) 

    const page = await axios.get('https://ibb.co/hJszTg0K')

    const match = page.data.match(
      /<meta property="og:image" content="([^"]+)"/i
    )

    if (!match) throw 'Image not found'

    const imageUrl = match[1]

    // تجهيز الصورة كرسالة ميديا للأزرار
    const media = await prepareWAMessageMedia(
      {
        image: { url: imageUrl }
      },
      {
        upload: conn.waUploadToServer
      }
    )

    // إنشاء رسالة الأزرار التفاعلية
    const msg = generateWAMessageFromContent(
      m.chat,
      {
        viewOnceMessage: {
          message: {
            interactiveMessage: {
              header: {
                hasMediaAttachment: true,
                imageMessage: media.imageMessage,
                title: 'اذا اردت تنزيل فيدو من < ig،fb,yt,tk >ارسل فقط رابط 🤍'
              },

              body: {
                text: 
`📥`
              },

              footer: {
                text: 'اختر أحد الأوامر من الأزرار أسفله <'
              },

              nativeFlowMessage: {
                buttons: [
                  {
                    name: 'quick_reply',
                    buttonParamsJson: JSON.stringify({
                      display_text: '🎵 .play',
                      id: '.play'
                    })
                  },
{
                    name: 'quick_reply',
                    buttonParamsJson: JSON.stringify({
                      display_text: '🧶 .tr',
                      id: '.tr'
                    })
                  },
                  
                  {
                    name: 'quick_reply',
                    buttonParamsJson: JSON.stringify({
                      display_text: '🧬 .tomp3',
                      id: '.tomp3'
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

    // إرسال الرسالة
    await conn.relayMessage(
      m.chat,
      msg.message,
      { messageId: msg.key.id }
    )
    
    await m.react('📜')

  } catch (e) {
    console.error(e)
    m.reply('❌ فشل إرسال القائمة')
  }
}

handler.command = ['menu']
handler.help = ['menu']
handler.tags = ['main']

export default handler