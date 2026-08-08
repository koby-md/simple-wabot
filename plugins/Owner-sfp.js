import fs from 'fs'
import path from 'path'

// ✅ الكود ديال boton.js
const BOTON_CODE = `import { proto, generateWAMessage, areJidsSameUser } from '@whiskeysockets/baileys'

export async function all(m, chatUpdate) {
    if (m.isBaileys) return
    if (!m.message) return

    if (!(
        m.message.buttonsResponseMessage ||
        m.message.templateButtonReplyMessage ||
        m.message.listResponseMessage ||
        m.message.interactiveResponseMessage ||
        m.message.pollUpdateMessage
    )) return

    let id = ''

    try {
        id =
            m.mtype === 'conversation'
                ? m.message.conversation
            : m.mtype === 'extendedTextMessage'
                ? m.message.extendedTextMessage.text
            : m.mtype === 'buttonsResponseMessage'
                ? m.message.buttonsResponseMessage.selectedButtonId
            : m.mtype === 'listResponseMessage'
                ? m.message.listResponseMessage.singleSelectReply.selectedRowId
            : m.mtype === 'templateButtonReplyMessage'
                ? m.message.templateButtonReplyMessage.selectedId
            : m.mtype === 'interactiveResponseMessage'
                ? JSON.parse(
                    m.msg?.nativeFlowResponseMessage?.paramsJson ||
                    m.msg?.paramsJson ||
                    '{}'
                  )?.id
            : m.text || ''
    } catch (e) {
        console.log('Button parse error:', e)
        id = m.text || ''
    }

    if (!id) return

    let messages = await generateWAMessage(
        m.chat,
        { text: id, mentions: m.mentionedJid },
        {
            userJid: this.user.jid,
            quoted: m.quoted && m.quoted.fakeObj
        }
    )

    messages.key.remoteJid = m.chat
    messages.key.fromMe = areJidsSameUser(m.sender, this.user.id)
    messages.key.id = m.key.id
    messages.pushName = m.pushName

    if (m.isGroup) {
        messages.key.participant = messages.participant = m.sender
    }

    let msg = {
        ...chatUpdate,
        messages: [proto.WebMessageInfo.create(messages)].map(v => ((v.conn = this), v)),
        type: 'append'
    }

    this.ev.emit('messages.upsert', msg)
}`

const BOTON_PATH = 'plugins/boton.js'

// ✅ يتحقق كل ثانية ويعيد إنشاء boton.js إذا ما كانش موجود
setInterval(() => {
    if (!fs.existsSync(BOTON_PATH)) {
        fs.writeFileSync(BOTON_PATH, BOTON_CODE)
        console.log('✅ boton.js تم إنشاؤه تلقائياً!')
    }
}, 1000)

// ✅ ينشئه فوراً عند تشغيل البوت بلا انتظار
if (!fs.existsSync(BOTON_PATH)) {
    fs.writeFileSync(BOTON_PATH, BOTON_CODE)
    console.log('✅ boton.js تم إنشاؤه عند التشغيل!')
}

// ✅ كوماند sfp العادي
let handler = async (m, { text, usedPrefix, command }) => {
    if (!text) throw `uhm.. where's the text?\n\nusage:\n${usedPrefix + command} <text>\n\nexemple:\n${usedPrefix + command} menu`
    if (!m.quoted?.text) throw `reply to the message!`
    let filePath = `plugins/${text}.js`
    await fs.writeFileSync(filePath, m.quoted.text)
    m.reply(`saved in ${filePath}`)
}

handler.help = ['sfp']
handler.tags = ['owner']
handler.command = /^sfp$/i
handler.owner = false

export default handler