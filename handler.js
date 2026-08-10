import { smsg } from './lib/whatsapp.js'
import { format } from 'util' 
import { fileURLToPath } from 'url'
import path, { join } from 'path'
import { unwatchFile, watchFile } from 'fs'
import chalk from 'chalk'
import fetch from 'node-fetch'

/**
 * @type {import('@whiskeysockets/baileys')}
 */
const { proto } = (await import('@whiskeysockets/baileys')).default
const isNumber = x => typeof x === 'number' && !isNaN(x)

const delay = ms => isNumber(ms) && new Promise(resolve => setTimeout(function () {
    clearTimeout(this)
    resolve()
}, ms))

export async function handler(chatUpdate) {

    let settings = {}
    this.msgqueque = this.msgqueque || []

    if (!chatUpdate)
        return

    let m = chatUpdate.messages[chatUpdate.messages.length - 1]
    if (!m)
        return
    if (global.db.data == null)
        await global.loadDatabase()

    global.db.data ||= {}
    global.db.data.users ||= {}
    global.db.data.chats ||= {}
    global.db.data.stats ||= {} 
    global.db.data.settings ||= {}
    global.db.data.statsMsg ||= {} 

    try {
        m = smsg(this, m) || m
        if (!m)
            return
        m.exp = 0
        m.coin = 0
        m.diamond = false

        try {
            const userDefaults = {
                exp: 0,
                coin: 0,
                diamond: 20,
                bank: 0,
                registered: false,
                name: m.name,
                age: -1,
                regTime: -1,
                afk: -1,
                afkReason: '',
                banned: false,
                level: 0,
                role: 'مبتدئ',
                autolevelup: false,
            }

            if (!global.db.data.users[m.sender])
                global.db.data.users[m.sender] = {}

            let user = global.db.data.users[m.sender]

            for (let key in userDefaults) {
                if (!(key in user) || user[key] === undefined || user[key] === null) {
                    user[key] = userDefaults[key]
                }
            }

            const chatDefaults = {
                isBanned: false,
                welcome: false,
                detect: false,
                sWelcome: '',
                sBye: '',
                sPromote: '',
                sDemote: '',
                antiLink: false,
                nsfw: false,
                rules: '',
                antiBotClone: false
            }

            if (!global.db.data.chats[m.chat])
                global.db.data.chats[m.chat] = {}

            let chat = global.db.data.chats[m.chat]

            for (let key in chatDefaults) {
                if (!(key in chat) || chat[key] === undefined || chat[key] === null) {
                    chat[key] = chatDefaults[key]
                }
            }

        } catch (e) {
            console.error('Error initializing data:', e)
        }

        const opts = global.opts || {}
        const isGroup = m.chat?.endsWith('g.us')
        const text = typeof m.text === 'string' ? m.text : ''
        m.text = text

        if (!global.db.data.users[m.sender]) {
            global.db.data.users[m.sender] = {
                exp: 0,
                diamond: 20,
                level: 0,
                prem: false
            }
        }

        let _user = global.db.data && global.db.data.users && global.db.data.users[m.sender]

        // 🟢 التعديل الخاص بإصلاح مشكلة الـ @lid والرد في الخاص
        const botNumber = this.user?.id?.split(':')[0] + '@s.whatsapp.net'
        const sender = m.sender ? (m.sender.includes('@lid') ? m.sender.split(':')[0] + '@lid' : m.sender.split(':')[0] + '@s.whatsapp.net') : ''
        const normalize = v => {
            if (typeof v !== 'string') return String(v)
            if (v.includes('@lid')) return v.split(':')[0] + '@lid'
            return v.replace(/[^0-9]/g, '') + '@s.whatsapp.net'
        }

        if (m.chat && m.chat.includes('@lid')) {
            m.chat = m.chat.split(':')[0] + '@lid'
        } else if (m.chat && !m.chat.endsWith('@g.us')) {
            m.chat = m.chat.split(':')[0] + '@s.whatsapp.net'
        }
        // 🟢 نهاية التعديل

        const isROwner = sender === botNumber || (global.owner || []).some(v => sender === normalize(Array.isArray(v) ? v[0] : v))
        const isOwner = isROwner || m.fromMe
        const isMods = isOwner || (global.mods || []).map(v => normalize(v)).includes(sender)
        const isPrems = isROwner || (global.prems || []).map(v => normalize(v)).includes(sender) || (_user?.prem === true)

        if (m.isBaileys)
            return
        m.exp += Math.ceil(Math.random() * 10)

        let usedPrefix

        const groupMetadata = m.isGroup ? await this.groupMetadata(m.chat).catch(() => null) : null
        const participants = groupMetadata?.participants || []
        const user = (m.isGroup ? participants.find(u => { let id = this.decodeJid(u.id || u.jid); return [this.decodeJid(m.sender), this.decodeJid(m.key?.participant), this.decodeJid(m.participant)].filter(Boolean).includes(id) }) : {}) || {}
        const bot = (m.isGroup ? participants.find(u => { let id = this.decodeJid(u.id || u.jid); return id === this.decodeJid(this.user.jid) || id === this.decodeJid(this.user.lid) }) : {}) || {}

        const isRAdmin = user?.admin === 'superadmin' || this.decodeJid(groupMetadata?.owner) === this.decodeJid(m.sender)
        const isAdmin = !!user?.admin || this.decodeJid(groupMetadata?.owner) === this.decodeJid(m.sender)
        const isBotAdmin = !!bot?.admin

        const ___dirname = path.join(path.dirname(fileURLToPath(import.meta.url)), './plugins')

        for (let name in global.plugins) {
            let plugin = global.plugins[name]
            if (!plugin)
                continue
            if (plugin.disabled)
                continue
            const __filename = join(___dirname, name)

            if (typeof plugin.all === 'function') {
                try {
                    await plugin.all.call(this, m, {
                        chatUpdate,
                        __dirname: ___dirname,
                        __filename
                    })
                } catch (e) {
                    console.error(e)
                }
            }

            const str2Regex = str => str.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
            let _prefix = plugin.customPrefix ? plugin.customPrefix : conn.prefix ? conn.prefix : global.prefix

            let match = (_prefix instanceof RegExp ? 
                [[_prefix.exec(m.text), _prefix]] :
                Array.isArray(_prefix) ? 
                    _prefix.map(p => {
                        let re = p instanceof RegExp ? p : new RegExp(str2Regex(p))
                        return [re.exec(m.text), re]
                    }) :
                    typeof _prefix === 'string' ? 
                        [[new RegExp(str2Regex(_prefix)).exec(m.text), new RegExp(str2Regex(_prefix))]] :
                        [[[], new RegExp]]
            ).find(p => p[1])

            if (typeof plugin.before === 'function') {
                if (await plugin.before.call(this, m, {
                    match,
                    conn: this,
                    participants,
                    groupMetadata,
                    user,
                    bot,
                    isROwner,
                    isOwner,
                    isRAdmin,
                    isAdmin,
                    isBotAdmin,
                    isPrems,
                    chatUpdate,
                    __dirname: ___dirname,
                    __filename
                }))
                    continue
            }

            if (typeof plugin !== 'function')
                continue

            if ((usedPrefix = (match[0] || '')[0])) {
                let noPrefix = m.text.replace(usedPrefix, '')
                let [command, ...args] = noPrefix.trim().split` `.filter(v => v)
                args = args || []
                let _args = noPrefix.trim().split` `.slice(1)
                let text = _args.join` `
                command = (command || '').toLowerCase()
                let fail = plugin.fail || global.dfail 
                let isAccept = plugin.command instanceof RegExp ? 
                    plugin.command.test(command) :
                    Array.isArray(plugin.command) ? 
                        plugin.command.some(cmd => cmd instanceof RegExp ? cmd.test(command) : cmd === command) :
                        typeof plugin.command === 'string' ? 
                            plugin.command === command :
                            false

                if (!isAccept)
                    continue
                m.plugin = name

                if (plugin.rowner && plugin.owner && !(isROwner || isOwner)) { 
                    fail('owner', m, this)
                    continue
                }
                if (plugin.rowner && !isROwner) { 
                    fail('rowner', m, this)
                    continue
                }
                if (plugin.owner && !isOwner) { 
                    fail('owner', m, this)
                    continue
                }
                if (plugin.mods && !isMods) { 
                    fail('mods', m, this)
                    continue
                }
                if (plugin.premium && !isPrems) { 
                    fail('premium', m, this)
                    continue
                }
                if (plugin.group && !m.isGroup) { 
                    fail('group', m, this)
                    continue
                } else if (plugin.botAdmin && !isBotAdmin) { 
                    fail('botAdmin', m, this)
                    continue
                } else if (plugin.admin && !isAdmin) { 
                    fail('admin', m, this)
                    continue
                }
                if (plugin.private && m.isGroup) { 
                    fail('public', m, this)
                    continue
                }
                if (plugin.register == true && _user.registered == false) { 
                    fail('unreg', m, this)
                    continue
                }
                m.isCommand = true
                let xp = 'exp' in plugin ? parseInt(plugin.exp) : 17 
                if (xp > 200)
                    m.reply('تجاوزت الحد المسموح -_-') 
                else
                    m.exp += xp
                if (!isPrems && plugin.diamond && global.db.data.users[m.sender].diamond < plugin.diamond * 1) {
                    this.reply(m.chat, `✳️ لقد نفذت مجوهراتك 💎\nاستخدم الأمر التالي لشراء المزيد من المجوهرات:\n\n*${usedPrefix}buy*`, m)
                    continue 
                }
                if (plugin.level > _user.level) {
                    this.reply(m.chat, `✳️ هذا الأمر يتطلب المستوى ${plugin.level} لاستخدامه.\nمستواك الحالي هو: ${_user.level}`, m)
                    continue 
                }
                let extra = {
                    match,
                    usedPrefix,
                    noPrefix,
                    _args,
                    args,
                    command,
                    text,
                    conn: this,
                    participants,
                    groupMetadata,
                    user,
                    bot,
                    isROwner,
                    isOwner,
                    isRAdmin,
                    isAdmin,
                    isBotAdmin,
                    isPrems,
                    chatUpdate,
                    __dirname: ___dirname,
                    __filename
                }
                try {
                    await plugin.call(this, m, extra)
                    if (!isPrems)
                        m.diamond = m.diamond || plugin.diamond || false
                } catch (e) {
                    m.error = e
                    console.error(e)
                    if (e) {
                        let text = format(e)
                        for (let key of Object.values(global.APIKeys))
                            text = text.replace(new RegExp(key, 'g'), '#HIDDEN#')
                           m.reply(e) 
                    }
                } finally {
                    if (typeof plugin.after === 'function') {
                        try {
                            await plugin.after.call(this, m, extra)
                        } catch (e) {
                            console.error(e)
                        }
                    }
                    if (m.diamond)
                        m.reply(`تم استهلاك *${+m.diamond}* 💎`)
                }
                break
            }
        }
    } catch (e) {
        console.error(e)
    } finally {
        let user, stats = global.db.data.stats
        if (m) {
            if (m.sender && (user = global.db.data.users[m.sender])) {
                user.exp += m.exp
                user.diamond -= m.diamond * 1
            }

            if (m.isGroup && m.sender) {
                let statsMsg = global.db.data.statsMsg || {}
                let chatId = m.chat
                let userId = m.sender

                if (!statsMsg[chatId]) statsMsg[chatId] = {}
                if (!statsMsg[chatId][userId]) statsMsg[chatId][userId] = 0

                statsMsg[chatId][userId] += 1
                global.db.data.statsMsg = statsMsg
            }

            let stat
            if (m.plugin) {
                let now = +new Date
                if (m.plugin in stats) {
                    stat = stats[m.plugin]
                    if (!isNumber(stat.total))
                        stat.total = 1
                    if (!isNumber(stat.success))
                        stat.success = m.error != null ? 0 : 1
                    if (!isNumber(stat.last))
                        stat.last = now
                    if (!isNumber(stat.lastSuccess))
                        stat.lastSuccess = m.error != null ? 0 : now
                } else
                    stat = stats[m.plugin] = {
                        total: 1,
                        success: m.error != null ? 0 : 1,
                        last: now,
                        lastSuccess: m.error != null ? 0 : now
                    }
                stat.total += 1
                stat.last = now
                if (m.error == null) {
                    stat.success += 1
                    stat.lastSuccess = now
                }
            }
        }

        try {
            if (!opts['noprint']) await (await import(`./lib/print.js`)).default(m, this)
        } catch (e) {
            console.log(m, m.quoted, e)
        }
        if (opts['autoread'])
            await this.chatRead(m.chat, m.isGroup ? m.sender : undefined, m.id || m.key.id).catch(() => { })
    }
}

export async function participantsUpdate({ id, participants, action }) {
    if (opts['self']) return
    if (global.db.data == null) await global.loadDatabase()

    let chat = global.db.data.chats[id] || {}
    let text = ''
    const normalize = (p) => typeof p === 'string' ? p : p?.id

    switch (action) {
        case 'add':
        case 'remove':
            if (!chat.welcome) break
            let groupMetadata = await this.groupMetadata(id).catch(_ => null) || (global.conn.chats[id] || {}).metadata
            if (!groupMetadata) return

            for (let participant of participants) {
                const user = normalize(participant)
                if (!user) continue

                let pp = global.fg_avatar || 'https://i.ibb.co/fkFmQC2/eve.jpg'
                let ppgp = global.fg_avatar || 'https://i.ibb.co/fkFmQC2/eve.jpg'
                try { pp = await this.profilePictureUrl(user, 'image') } catch {}
                try { ppgp = await this.profilePictureUrl(id, 'image') } catch {}

                text = (action === 'add'
                    ? (chat.sWelcome || this.welcome || global.conn.welcome || 'مرحباً بك، @user')
                        .replace('@group', await this.getName(id))
                        .replace('@desc', groupMetadata.desc?.toString() || 'غير متوفر')
                    : (chat.sBye || this.bye || global.conn.bye || 'وداعاً، @user')
                ).replace('@user', '@' + user.split('@')[0])

                try {
                    let imageUrl = action === 'add'
                        ? global.API('fgmods', '/api/welcome', {
                            username: await this.getName(user),
                            groupname: await this.getName(id),
                            groupicon: ppgp,
                            membercount: groupMetadata.participants?.length || 0,
                            profile: pp,
                            background: 'https://i.ibb.co/fkFmQC2/eve.jpg'
                        }, 'apikey')
                        : global.API('fgmods', '/api/goodbye2', {
                            username: await this.getName(user),
                            groupname: await this.getName(id),
                            groupicon: ppgp,
                            membercount: groupMetadata.participants?.length || 0,
                            profile: pp,
                            background: 'https://i.ibb.co/jh9367t/akali.jpg'
                        }, 'apikey')

                    await this.sendFile(id, imageUrl, 'welcome.jpg', text, null, false, { mentions: [user] })
                } catch {
                    await this.sendFile(id, pp, 'profile.jpg', text, null, false, { mentions: [user] })
                }
            }
            break

        case 'promote':
        case 'demote':
            if (!chat.detect) break
            for (let participant of participants) {
                const user = normalize(participant)
                if (!user) continue
                let pp = await this.profilePictureUrl(user, 'image').catch(_ => global.fg_avatar)
                text = action === 'promote'
                    ? (chat.sPromote || this.spromote || global.conn.spromote || '@user أصبح الآن مشرفاً في المجموعة 🛡️')
                    : (chat.sDemote || this.sdemote || global.conn.sdemote || '@user تم تنزيله من الإشراف')
                text = text.replace('@user', '@' + user.split('@')[0])
                await this.sendFile(id, pp, 'pp.jpg', text, null, false, { mentions: [user] })
            }
            break
    }
}

export async function groupsUpdate(groupsUpdate) {
    if (opts['self']) return
    for (const groupUpdate of groupsUpdate) {
        const id = groupUpdate.id
        if (!id) continue
        let chats = global.db.data.chats[id], text = ''
        if (!chats?.detect) continue
        if (groupUpdate.desc) text = (chats.sDesc || this.sDesc || global.conn.sDesc).replace('@desc', groupUpdate.desc)
        if (groupUpdate.subject) text = (chats.sSubject || this.sSubject || global.conn.sSubject).replace('@group', groupUpdate.subject)
        if (groupUpdate.icon) text = (chats.sIcon || this.sIcon || global.conn.sIcon).replace('@icon', groupUpdate.icon)
        if (groupUpdate.revoke) text = (chats.sRevoke || this.sRevoke || global.conn.sRevoke).replace('@revoke', groupUpdate.revoke)
        if (!text) continue
        await this.sendMessage(id, { text, mentions: this.parseMention(text) })
    }
}

export async function deleteUpdate(update) {
    try {
        const { key, update: msgUpdate } = update || {}
        if (!key || !msgUpdate) return
        const { remoteJid, id, participant, fromMe } = key
        if (fromMe) return

        const isDelete = msgUpdate?.message?.protocolMessage?.type === 0 || msgUpdate?.messageStubType === 1
        if (!isDelete) return

        let raw = await this.loadMessage(remoteJid, id)
        if (!raw || !raw.message) return
        if (!raw.key) raw.key = {}
        if (raw.key.fromMe === undefined) raw.key.fromMe = false

        let msg = this.serializeM ? this.serializeM(raw) : raw
        let chat = global.db.data.chats?.[msg.chat] || {}
        if (chat.delete) return

        let user = participant || remoteJid
        let pushName = msg.pushName || 'غير معروف'
        let type = Object.keys(msg.message || {})[0] || 'غير معروف'
        let text = msg.text || msg.message?.conversation || msg.message?.extendedTextMessage?.text || 'بدون نص'

        let info = `
≡ *استرجاع الرسائل المحذوفة*

┌─⊷ 📌 *المستخدم*
▢ *الرقم* : @${user.split('@')[0]}
└─────────────
┌─⊷ 💬 *الرسالة*
▢ *النوع* : ${type}
▢ *المحتوى* :👇🏻
└───────────
`.trim()

        await this.reply(msg.chat, info, msg, { mentions: [user] })
        await this.copyNForward(msg.chat, raw).catch(e => console.log('Forward error:', e))
    } catch (e) {
        console.error('Error en deleteUpdate:', e)
    }
}

global.dfail = (type, m, conn) => {
    let msg = {
        rowner: `👑 هذا الأمر مخصص فقط لـ *مطور البوت* الأساسي.`,
        owner: `🔱 هذا الأمر مخصص فقط لـ *المطورين* (Owner / Sub Bots).`,
        mods: `🔰 هذه الميزة مخصصة فقط لـ *مشرفي البوت*.`,
        premium: `💠 هذا الأمر مخصص للأعضاء *المميزين (Premium)* فقط.\n\nاكتب */premium* لمزيد من المعلومات.`,
        group: `⚙️ يمكن استخدام هذا الأمر في *المجموعات* فقط.`,
        private: `📮 يمكن استخدام هذا الأمر في *الخاص* فقط.`,
        admin: `🛡️ هذا الأمر مخصص فقط لـ *مشرفي المجموعة*.`,
        botAdmin: `💥 يجب أن يكون البوت *مشرفاً* لاستخدام هذا الأمر!`,
        unreg: `📇 الرجاء التسجيل أولاً لاستخدام هذه الميزة. للبدء اكتب:\n\n*/reg*`,
        restrict: `🔐 هذه الميزة *معطلة* حالياً.`
    }[type]
    if (msg) return m.reply(msg)
}

let file = global.__filename(import.meta.url, true)
watchFile(file, async () => {
    unwatchFile(file)
    console.log(chalk.magenta("✅ تم تحديث 'handler.js'"))
    if (global.reloadHandler) console.log(await global.reloadHandler())
})