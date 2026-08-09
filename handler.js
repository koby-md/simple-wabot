import {
  getAggregateVotesInPollMessage,
  proto,
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  jidNormalizedUser,
  WAMessageStubType,
} from '@whiskeysockets/baileys'

import { smsg } from './lib/serialize.js'
import initDatabase from './lib/database.js'
import printMsg from './lib/print.js'
import moment from 'moment-timezone'
import fs from 'fs'
import util from 'util'
import chalk from 'chalk'

const isNumber = (x) =>
  typeof x === 'number' && !Number.isNaN(x)

const delay = (ms) =>
  isNumber(ms) && new Promise(resolve => setTimeout(resolve, ms))

/* =========================================================
   ERROR FORMAT
========================================================= */

function formatError(error) {
  if (error == null) return 'Unknown error'

  if (typeof error === 'string') {
    return error
  }

  if (error instanceof Error) {
    return error.stack || error.message || String(error)
  }

  try {
    return util.inspect(error, {
      depth: 8,
      colors: false,
      compact: false,
    })
  } catch {
    return String(error)
  }
}

/* =========================================================
   NORMALIZE JID
========================================================= */

function normalizeOwnerNumber(owner) {
  const value = Array.isArray(owner)
    ? owner[0]
    : owner

  return String(value || '').replace(/[^0-9]/g, '')
}

function getNormalJid(conn, jid) {
  if (!jid) return ''

  try {
    if (conn?.getJid) {
      const result = conn.getJid(jid)
      if (result) return result
    }
  } catch {}

  try {
    if (conn?.decodeJid) {
      const result = conn.decodeJid(jid)
      if (result) return result
    }
  } catch {}

  return jid
}

/* =========================================================
   FORCE ONLINE
========================================================= */

async function keepOnline(conn) {
  try {
    if (!conn?.user) return

    if (typeof conn.sendPresenceUpdate === 'function') {
      await conn.sendPresenceUpdate('available')
    }
  } catch {}
}

/* =========================================================
   FORCE READ
========================================================= */

async function markMessageRead(conn, message) {
  try {
    if (!message?.key) return

    if (typeof conn.readMessages === 'function') {
      await conn.readMessages([message.key])
    }
  } catch {}
}

/* =========================================================
   REBUILD QUOTED MESSAGE
   مهم جدًا للـ LID والرد على فيديو/أوديو
========================================================= */

async function ensureQuotedMessage(conn, m, rawMessage) {
  try {
    if (m?.quoted) return m.quoted

    const message = rawMessage?.message
    if (!message) return null

    let contextInfo = null

    if (message.extendedTextMessage?.contextInfo) {
      contextInfo = message.extendedTextMessage.contextInfo
    } else if (message.imageMessage?.contextInfo) {
      contextInfo = message.imageMessage.contextInfo
    } else if (message.videoMessage?.contextInfo) {
      contextInfo = message.videoMessage.contextInfo
    } else if (message.audioMessage?.contextInfo) {
      contextInfo = message.audioMessage.contextInfo
    } else if (message.documentMessage?.contextInfo) {
      contextInfo = message.documentMessage.contextInfo
    } else if (message.buttonsResponseMessage?.contextInfo) {
      contextInfo = message.buttonsResponseMessage.contextInfo
    } else if (message.listResponseMessage?.contextInfo) {
      contextInfo = message.listResponseMessage.contextInfo
    }

    if (!contextInfo?.quotedMessage) {
      return null
    }

    const quotedParticipant =
      contextInfo.participant ||
      rawMessage.key?.participant ||
      m.sender

    const quotedKey = {
      remoteJid: m.chat,
      fromMe: false,
      id: contextInfo.stanzaId,
      participant: quotedParticipant,
    }

    const fakeQuoted = {
      key: quotedKey,
      message: contextInfo.quotedMessage,
    }

    const quoted = smsg(conn, fakeQuoted)

    if (quoted) {
      quoted.isQuoted = true
      quoted.chat = m.chat
      quoted.sender = quotedParticipant
      quoted.fromMe = false

      /*
       * بعض serializers تعتمد على msg بدل message
       */
      if (!quoted.msg && contextInfo.quotedMessage) {
        quoted.msg = contextInfo.quotedMessage
      }

      m.quoted = quoted
      return quoted
    }
  } catch (error) {
    console.error(
      chalk.yellow('[Quoted Recovery Error]'),
      formatError(error)
    )
  }

  return null
}

/* =========================================================
   MAIN HANDLER
========================================================= */

export async function handler(chatUpdate) {
  if (global.db.data == null) {
    await global.loadDatabase()
  }

  this.msgqueque = this.msgqueque || []

  if (!chatUpdate) return
  if (!chatUpdate.messages) return
  if (!chatUpdate.messages.length) return

  try {
    await this.pushMessage(chatUpdate.messages)
  } catch (error) {
    console.error(
      chalk.yellow('[PushMessage Error]'),
      formatError(error)
    )
  }

  let m = chatUpdate.messages[chatUpdate.messages.length - 1]

  if (!m) return
  if (!m.key) return

  /*
   * لا نعالج رسائل البوت نفسه
   */
  if (m.key.fromMe) return

  if (!m.message) return

  /*
   * تجاهل protocol
   */
  if (m.message.protocolMessage) return

  /*
   * لا نعتبر reaction رسالة command
   */
  if (m.message.reactionMessage) return

  /*
   * اقرأ الرسالة دائمًا:
   * الخاص + المجموعات
   */
  await markMessageRead(this, m)

  /*
   * اجعل الحالة Available
   */
  await keepOnline(this)

  try {
    m = smsg(this, m) || m

    if (!m) return

    /*
     * إصلاح quoted message خصوصًا @lid
     */
    await ensureQuotedMessage(this, m, chatUpdate.messages[chatUpdate.messages.length - 1])

    m.exp = 0

    /*
     * مهم:
     * لا نستخدم limit لإيقاف الأمر
     *
     * false = لا يتم خصم limit
     */
    m.limit = false

    /*
     * Init database
     */
    try {
      initDatabase(m)
    } catch (error) {
      console.error(
        chalk.yellow('[Database Init Error]'),
        formatError(error)
      )
    }

    /* =====================================================
       USER / SENDER
    ===================================================== */

    let senderJid = ''

    try {
      if (m.sender?.endsWith('@lid')) {
        senderJid =
          this.getJid
            ? this.getJid(m.sender)
            : this.decodeJid(m.sender)
      } else {
        senderJid =
          this.decodeJid
            ? this.decodeJid(m.sender)
            : m.sender
      }
    } catch {
      senderJid = m.sender
    }

    /*
     * إذا لم يوجد user
     */
    if (!global.db.data.users[senderJid]) {
      global.db.data.users[senderJid] = {
        exp: 0,
        limit: 0,
        premium: false,
        premiumDate: null,
        moderator: false,
        banned: false,
        online: 0,
        chat: 0,
        registered: false,
        registeredTime: 0,
        level: 0,
      }
    }

    const userData = global.db.data.users[senderJid]

    /* =====================================================
       OWNER
    ===================================================== */

    const ownerJids = []

    try {
      ownerJids.push(
        this.decodeJid(global.conn?.user?.id || this.user?.id || '')
      )
    } catch {}

    for (const owner of global.owner || []) {
      const number = normalizeOwnerNumber(owner)

      if (!number) continue

      ownerJids.push(`${number}@s.whatsapp.net`)
      ownerJids.push(`${number}@lid`)
    }

    const normalizedSender = getNormalJid(this, senderJid)

    const isROwner =
      ownerJids.includes(senderJid) ||
      ownerJids.includes(normalizedSender)

    const isOwner =
      isROwner ||
      !!m.fromMe

    const isMods =
      !!userData.moderator

    const isPrems =
      !!userData.premium

    const isBans =
      !!userData.banned

    const isWhitelist =
      !!global.db.data.chats?.[m.chat]?.whitelist

    /* =====================================================
       OWNER AUTO PERMISSION
    ===================================================== */

    if (isROwner) {
      userData.premium = true
      userData.premiumDate = 'PERMANENT'
      userData.limit = 'PERMANENT'
      userData.moderator = true
    } else if (isPrems) {
      userData.limit = 'PERMANENT'
    } else if (isBans) {
      return
    }

    /* =====================================================
       GROUP METADATA
    ===================================================== */

    if (m.isGroup) {
      try {
        const meta = await this.groupMetadata(m.chat)

        if (!global.db.data.chats[m.chat]) {
          global.db.data.chats[m.chat] = {}
        }

        const members = (meta.participants || []).map(
          participant =>
            participant.id ||
            participant.phoneNumber
        )

        global.db.data.chats[m.chat].member = members
        global.db.data.chats[m.chat].chat =
          (global.db.data.chats[m.chat].chat || 0) + 1
      } catch (error) {
        console.error(
          chalk.yellow('[Group Metadata Error]'),
          formatError(error)
        )
      }
    }

    /* =====================================================
       SELF MODE
    ===================================================== */

    if (
      global.selfMode &&
      !isOwner &&
      !isPrems &&
      !isMods &&
      !isWhitelist
    ) {
      return
    }

    if (
      global.gconly &&
      !m.isGroup &&
      !isOwner
    ) {
      return
    }

    /* =====================================================
       QUEUE
    ===================================================== */

    if (
      global.opts?.queque &&
      m.text &&
      !(isMods || isPrems)
    ) {
      const queue = this.msgqueque
      const previous = queue[queue.length - 1]

      queue.push(m.id || m.key.id)

      if (previous) {
        const interval = setInterval(async () => {
          try {
            if (!queue.includes(previous)) {
              clearInterval(interval)
              return
            }

            await delay(5000)
          } catch {
            clearInterval(interval)
          }
        }, 5000)
      }
    }

    /* =====================================================
       USER DATA
    ===================================================== */

    userData.online = Date.now()
    userData.chat = (userData.chat || 0) + 1

    /*
     * قراءة إضافية بعد serialize
     */
    await markMessageRead(this, m)

    /*
     * لا ترجع بسبب nyimak إذا كنت تريد الأوامر تعمل
     */
    if (global.opts?.nyimak) {
      return
    }

    if (typeof m.text !== 'string') {
      m.text = ''
    }

    if (m.isBaileys) {
      return
    }

    m.exp += Math.ceil(Math.random() * 1000)

    /* =====================================================
       GROUP INFORMATION
    ===================================================== */

    let groupMetadata = {}

    if (m.isGroup) {
      try {
        groupMetadata =
          global.store?.groupMetadata?.[m.chat] ||
          await this.groupMetadata(m.chat) ||
          {}
      } catch {
        groupMetadata = {}
      }
    }

    const participants =
      m.isGroup
        ? groupMetadata.participants || []
        : []

    /*
     * JID الحقيقي للمستخدم
     */
    const userJid =
      this.getJid
        ? this.getJid(m.sender)
        : senderJid

    /* =====================================================
       FIND GROUP USER
    ===================================================== */

    const user =
      m.isGroup
        ? (
            participants.find(participant => {
              const id = getNormalJid(
                this,
                participant?.id || ''
              )

              const phone = getNormalJid(
                this,
                participant?.phoneNumber || ''
              )

              return (
                id === userJid ||
                phone === userJid ||
                participant?.id === m.sender ||
                participant?.phoneNumber === m.sender
              )
            }) || {}
          )
        : {}

    /* =====================================================
       FIND BOT
    ===================================================== */

    const bot =
      m.isGroup
        ? (
            participants.find(participant => {
              const botId =
                this.user?.id ||
                global.conn?.user?.id ||
                ''

              const decodedBot =
                getNormalJid(this, botId)

              const id =
                getNormalJid(
                  this,
                  participant?.id || ''
                )

              const phone =
                getNormalJid(
                  this,
                  participant?.phoneNumber || ''
                )

              return (
                id === decodedBot ||
                phone === decodedBot
              )
            }) || {}
          )
        : {}

    const isRAdmin =
      user?.admin === 'superadmin'

    const isAdmin =
      isRAdmin ||
      user?.admin === 'admin'

    const isBotAdmin =
      !!bot?.admin

    if (
      m.isGroup &&
      groupMetadata?.id
    ) {
      if (!global.store) {
        global.store = {}
      }

      if (!global.store.groupMetadata) {
        global.store.groupMetadata = {}
      }

      global.store.groupMetadata[m.chat] =
        groupMetadata
    }

    /* =====================================================
       PLUGINS
    ===================================================== */

    let usedPrefix

    const _user = userData

    for (const name in global.plugins) {
      const plugin = global.plugins[name]

      if (!plugin) continue
      if (plugin.disabled) continue

      /* ===================================================
         ALL
      =================================================== */

      if (typeof plugin.all === 'function') {
        try {
          await plugin.all.call(
            this,
            m,
            chatUpdate
          )
        } catch (error) {
          console.error(
            chalk.red(`[Plugin all Error] ${name}`),
            formatError(error)
          )
        }
      }

      /* ===================================================
         PREFIX
      =================================================== */

      const str2Regex = str =>
        String(str).replace(
          /[|\\{}()[\]^$+*?.]/g,
          '\\$&'
        )

      const _prefix =
        plugin.customPrefix
          ? plugin.customPrefix
          : this.prefix
            ? this.prefix
            : global.prefix

      let match = null

      if (_prefix instanceof RegExp) {
        /*
         * clone regex حتى لا تتأثر بـ lastIndex
         */
        const flags =
          (_prefix.ignoreCase ? 'i' : '') +
          (_prefix.global ? 'g' : '') +
          (_prefix.multiline ? 'm' : '')

        const regex =
          new RegExp(_prefix.source, flags)

        match = regex.exec(m.text)
      } else if (Array.isArray(_prefix)) {
        for (const p of _prefix) {
          const regex =
            p instanceof RegExp
              ? new RegExp(
                  p.source,
                  (p.ignoreCase ? 'i' : '') +
                  (p.global ? 'g' : '') +
                  (p.multiline ? 'm' : '')
                )
              : new RegExp(str2Regex(p))

          const result = regex.exec(m.text)

          if (result) {
            match = result
            break
          }
        }
      } else if (typeof _prefix === 'string') {
        const regex =
          new RegExp(str2Regex(_prefix))

        match = regex.exec(m.text)
      }

      /* ===================================================
         BEFORE
      =================================================== */

      if (typeof plugin.before === 'function') {
        try {
          const beforeResult =
            await plugin.before.call(
              this,
              m,
              {
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
                isBans,
                chatUpdate,
              }
            )

          if (beforeResult) {
            continue
          }
        } catch (error) {
          console.error(
            chalk.red(
              `[Plugin Before Error] ${name}`
            ),
            formatError(error)
          )

          /*
           * before error لا يوقف البوت
           */
          continue
        }
      }

      /*
       * Plugin يجب أن يكون function
       */
      if (typeof plugin !== 'function') {
        continue
      }

      if (!match) {
        continue
      }

      /* ===================================================
         COMMAND
      =================================================== */

      const matchPrefix =
        match[0] || ''

      const result =
        (
          global.opts?.multiprefix ?? true
        ) && matchPrefix[0]
          ? matchPrefix[0]
          : (
              global.opts?.noprefix
                ? null
                : matchPrefix[0]
            )

      usedPrefix = result || ''

      let noPrefix

      if (isOwner) {
        noPrefix =
          !result
            ? m.text
            : m.text.replace(
                result,
                ''
              )
      } else {
        noPrefix =
          !result
            ? ''
            : m.text.replace(
                result,
                ''
              ).trim()
      }

      let [command, ...args] =
        noPrefix
          .trim()
          .split(/\s+/)
          .filter(Boolean)

      args = args || []

      const _args =
        noPrefix
          .trim()
          .split(/\s+/)
          .slice(1)

      const text =
        _args.join(' ')

      command =
        (command || '').toLowerCase()

      const fail =
        plugin.fail ||
        global.dfail

      const prefixCommand =
        !result
          ? plugin.customPrefix ||
            plugin.command
          : plugin.command

      let isAccept = false

      if (prefixCommand instanceof RegExp) {
        const regex =
          new RegExp(
            prefixCommand.source,
            prefixCommand.ignoreCase
              ? 'i'
              : ''
          )

        isAccept =
          regex.test(command)
      } else if (Array.isArray(prefixCommand)) {
        isAccept =
          prefixCommand.some(c => {
            if (c instanceof RegExp) {
              const regex =
                new RegExp(
                  c.source,
                  c.ignoreCase
                    ? 'i'
                    : ''
                )

              return regex.test(command)
            }

            return c === command
          })
      } else if (
        typeof prefixCommand === 'string'
      ) {
        isAccept =
          prefixCommand === command
      }

      m.prefix = !!result
      usedPrefix = result || ''

      if (!isAccept) {
        continue
      }

      /* ===================================================
         COMMAND META
      =================================================== */

      m.plugin = name
      m.chatUpdate = chatUpdate
      m.command = command
      m.isCommand = true

      /* ===================================================
         CHAT GUARDS
      =================================================== */

      const chatData =
        global.db.data.chats?.[m.chat]

      if (
        chatData?.isBanned &&
        !isOwner
      ) {
        return
      }

      if (
        chatData?.mute &&
        !isAdmin &&
        !isOwner
      ) {
        return
      }

      /* ===================================================
         BLOCK COMMAND
      =================================================== */

      if (
        global.db.data.settings?.blockcmd?.includes(
          command
        )
      ) {
        await fail('block', m, this)
        continue
      }

      /* ===================================================
         PERMISSIONS
      =================================================== */

      if (
        plugin.rowner &&
        !isROwner
      ) {
        await fail('rowner', m, this)
        continue
      }

      if (
        plugin.owner &&
        !isOwner
      ) {
        await fail('owner', m, this)
        continue
      }

      if (
        plugin.mods &&
        !isMods
      ) {
        await fail('mods', m, this)
        continue
      }

      if (
        plugin.premium &&
        !isPrems
      ) {
        await fail('premium', m, this)
        continue
      }

      if (
        plugin.group &&
        !m.isGroup
      ) {
        await fail('group', m, this)
        continue
      }

      if (
        plugin.botAdmin &&
        !isBotAdmin
      ) {
        await fail('botAdmin', m, this)
        continue
      }

      if (
        plugin.admin &&
        !isAdmin
      ) {
        await fail('admin', m, this)
        continue
      }

      if (
        plugin.private &&
        m.isGroup
      ) {
        await fail('private', m, this)
        continue
      }

      if (
        plugin.register &&
        !_user.registered
      ) {
        await fail('unreg', m, this)
        continue
      }

      /*
       * ==================================================
       * IMPORTANT:
       *
       * تم حذف LIMIT CHECK بالكامل.
       *
       * لن تظهر:
       * LIMIT HABIS
       * ==================================================
       */

      /* ===================================================
         LEVEL
      =================================================== */

      if (
        plugin.level &&
        plugin.level > (_user.level || 0)
      ) {
        await this.reply(
          m.chat,
          `*[ LEVEL KURANG ]*\n> Butuh level *${plugin.level}* untuk menggunakan fitur ini.`,
          m
        )

        continue
      }

      /* ===================================================
         STATS
      =================================================== */

      const now = Date.now()

      if (!global.db.data.respon) {
        global.db.data.respon = {}
      }

      const stat =
        global.db.data.respon[m.command]

      if (stat) {
        stat.total =
          (stat.total || 0) + 1

        stat.last = now
      } else {
        global.db.data.respon[m.command] = {
          total: 1,
          success: 0,
          last: now,
          lastSuccess: 0,
        }
      }

      const xp =
        'exp' in plugin
          ? parseInt(plugin.exp)
          : 17

      m.exp +=
        Number.isFinite(xp)
          ? xp
          : 17

      /* ===================================================
         EXTRA
      =================================================== */

      const extra = {
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
        isBans,

        chatUpdate,
      }

      /* ===================================================
         RUN PLUGIN
      =================================================== */

      try {
        await plugin.call(
          this,
          m,
          extra
        )

        /*
         * لا نخصم limit تلقائيًا.
         *
         * إذا أردت plugin معين يخصم limit،
         * يمكنك لاحقًا التحكم به من داخل plugin.
         */
        m.limit = false

        const s =
          global.db.data.respon[m.command]

        if (s) {
          s.success =
            (s.success || 0) + 1

          s.lastSuccess = now
        }

      } catch (error) {
        m.error = error

        const errorText =
          formatError(error)

        console.error(
          chalk.red(
            `[Plugin Error] ${m.plugin}`
          )
        )

        console.error(errorText)

        /*
         * =================================================
         * SEND ERROR TO USER
         *
         * يعمل حتى لو:
         *
         * throw 'رسالة'
         *
         * وليس فقط Error()
         * =================================================
         */

        try {
          const errorMessage =
            `*[ BOT ERROR ]*\n\n` +
            `*Plugin:* ${m.plugin}\n` +
            `*Command:* ${usedPrefix}${command}\n` +
            `*From:* ${m.sender || 'Unknown'}\n` +
            `*Chat:* ${m.chat || 'Unknown'}\n\n` +
            `*Error:*\n` +
            `${errorText}`

          await this.reply(
            m.chat,
            errorMessage,
            m
          )
        } catch (sendError) {
          console.error(
            chalk.red(
              '[Send Error Message Failed]'
            ),
            formatError(sendError)
          )
        }

        /*
         * لا نرسل الرسالة العامة:
         *
         * [ Sistem ]
         * Terjadi error pada bot!
         *
         * لأننا نريد الخطأ الحقيقي.
         */
      } finally {
        /* ================================================
           AFTER
        ================================================= */

        if (
          typeof plugin.after === 'function'
        ) {
          try {
            await plugin.after.call(
              this,
              m,
              extra
            )
          } catch (error) {
            console.error(
              chalk.red(
                `[Plugin After Error] ${name}`
              ),
              formatError(error)
            )
          }
        }
      }

      /*
       * أمر واحد فقط لكل رسالة
       */
      break
    }

  } catch (error) {
    /*
     * =====================================================
     * GLOBAL HANDLER ERROR
     * =====================================================
     */

    const errorText =
      formatError(error)

    console.error(
      chalk.red('[Handler Error]')
    )

    console.error(errorText)

    /*
     * نحاول إرسال الخطأ للمستخدم
     */
    try {
      if (m?.chat) {
        await this.reply(
          m.chat,
          `*[ BOT HANDLER ERROR ]*\n\n${errorText}`,
          m
        )
      }
    } catch (sendError) {
      console.error(
        chalk.red(
          '[Handler Error Reply Failed]'
        ),
        formatError(sendError)
      )
    }

  } finally {
    /* =====================================================
       QUEUE CLEANUP
    ===================================================== */

    try {
      if (
        global.opts?.queque &&
        m?.text
      ) {
        const id =
          m.id ||
          m.key?.id

        const index =
          this.msgqueque.indexOf(id)

        if (index !== -1) {
          this.msgqueque.splice(
            index,
            1
          )
        }
      }
    } catch {}

    /* =====================================================
       EXP UPDATE
    ===================================================== */

    try {
      if (m) {
        let finalSenderJid = ''

        if (
          m.sender?.endsWith('@lid')
        ) {
          finalSenderJid =
            this.getJid
              ? this.getJid(m.sender)
              : this.decodeJid(m.sender)
        } else {
          finalSenderJid =
            this.decodeJid
              ? this.decodeJid(m.sender)
              : m.sender
        }

        const u =
          global.db.data.users?.[
            finalSenderJid
          ]

        if (u) {
          u.exp =
            (u.exp || 0) +
            (m.exp || 0)

          /*
           * لا نخصم limit
           */
        }
      }
    } catch (error) {
      console.error(
        chalk.red(
          '[Handler User Data Error]'
        ),
        formatError(error)
      )
    }

    /* =====================================================
       PRINT
    ===================================================== */

    try {
      printMsg(m, this)
    } catch {}
  }
}

/* =========================================================
   PARTICIPANTS UPDATE
   WELCOME / BYE / PROMOTE / DEMOTE
========================================================= */

export async function participantsUpdate({
  id,
  participants,
  action,
}) {
  if (
    global.db.data == null
  ) {
    await global.loadDatabase()
  }

  const chat =
    global.db.data.chats?.[id] || {}

  switch (action) {
    /* =====================================================
       ADD / REMOVE
    ===================================================== */

    case 'add':
    case 'remove': {
      if (
        chat.welcome === false
      ) {
        return
      }

      let meta

      try {
        meta =
          await this.groupMetadata(id)
      } catch (error) {
        console.error(
          '[Welcome Metadata Error]',
          formatError(error)
        )

        break
      }

      for (
        const participant
        of participants || []
      ) {
        try {
          /*
           * participants قد يكون:
           *
           * object:
           * {
           *   id: 'xxx@lid',
           *   phoneNumber: 'xxx@s.whatsapp.net'
           * }
           *
           * أو string
           */

          const rawId =
            participant?.phoneNumber ||
            participant?.id ||
            participant

          let userJid =
            getNormalJid(
              this,
              rawId
            )

          /*
           * إذا بقي @lid
           * استخدم phoneNumber إن وجد
           */
          if (
            userJid.endsWith('@lid') &&
            participant?.phoneNumber
          ) {
            userJid =
              participant.phoneNumber
          }

          const userNumber =
            String(userJid)
              .split('@')[0]

          const gpname =
            meta.subject || ''

          const member =
            meta.participants?.length || 0

          const time =
            moment
              .tz('Asia/Jakarta')
              .format('HH:mm:ss')

          let pp =
            global.icon

          try {
            pp =
              await this.profilePictureUrl(
                userJid,
                'image'
              )
          } catch {}

          const defaultText =
            action === 'add'
              ? `┌─⭓「 *WELCOME* 」\n│ *User:* @user\n│ *Group:* ${gpname}\n│ *Member:* ${member}\n│ *Waktu:* ${time}\n└───────────────⭓\nSelamat datang!`
              : `┌─⭓「 *GOODBYE* 」\n│ *User:* @user\n│ *Group:* ${gpname}\n│ *Member:* ${member}\n│ *Waktu:* ${time}\n└───────────────⭓\nSampai jumpa!`

          let text =
            action === 'add'
              ? (
                  chat.sWelcome ||
                  defaultText
                )
              : (
                  chat.sBye ||
                  defaultText
                )

          text =
            text
              .replace(
                /@user/gi,
                `@${userNumber}`
              )
              .replace(
                /@group/gi,
                gpname
              )
              .replace(
                /@member/gi,
                String(member)
              )
              .replace(
                /@waktu/gi,
                time
              )
              .replace(
                /@desc/gi,
                meta.desc || '-'
              )

          await this.sendMessage(
            id,
            {
              text,

              mentions: [
                userJid,
              ],

              contextInfo: {
                mentionedJid: [
                  userJid,
                ],

                externalAdReply: {
                  title:
                    action === 'add'
                      ? 'Welcome notification!'
                      : 'Goodbye, notification!',

                  body:
                    global.wm || '',

                  thumbnailUrl:
                    pp,

                  mediaType: 1,

                  renderLargerThumbnail:
                    true,
                },
              },
            }
          )

        } catch (error) {
          console.error(
            chalk.red(
              '[Welcome/Bye Error]'
            ),
            formatError(error)
          )
        }
      }

      break
    }

    /* =====================================================
       PROMOTE / DEMOTE
    ===================================================== */

    case 'promote':
    case 'demote': {
      if (
        chat.detect === false
      ) {
        break
      }

      const participant =
        participants?.[0]

      if (!participant) break

      const rawId =
        participant?.phoneNumber ||
        participant?.id ||
        participant

      let userJid =
        getNormalJid(
          this,
          rawId
        )

      if (
        userJid.endsWith('@lid') &&
        participant?.phoneNumber
      ) {
        userJid =
          participant.phoneNumber
      }

      const userNumber =
        String(userJid)
          .split('@')[0]

      const text =
        action === 'promote'
          ? (
              chat.sPromote ||
              `@${userNumber} الآن أصبح Admin`
            )
          : (
              chat.sDemote ||
              `@${userNumber} لم يعد Admin`
            )

      await this.sendMessage(
        id,
        {
          text,
          mentions: [
            userJid,
          ],
        }
      )

      break
    }
  }
}

/* =========================================================
   DFAIL
========================================================= */

global.dfail = async (
  type,
  m,
  conn
) => {
  const msgs = {
    owner:
      `┌─⭓「 *OWNER ONLY* 」\n│ Fitur ini hanya untuk Owner!\n└───────────────⭓`,

    rowner:
      `┌─⭓「 *REAL OWNER ONLY* 」\n│ Fitur ini hanya untuk Real Owner!\n└───────────────⭓`,

    mods:
      `┌─⭓「 *MODERATOR ONLY* 」\n│ Fitur ini hanya untuk Moderator bot!\n└───────────────⭓`,

    premium:
      `┌─⭓「 *PREMIUM ONLY* 」\n│ Fitur ini hanya untuk pengguna Premium!\n└───────────────⭓`,

    group:
      `┌─⭓「 *GROUP ONLY* 」\n│ Fitur ini hanya bisa digunakan di Group!\n└───────────────⭓`,

    private:
      `┌─⭓「 *PRIVATE ONLY* 」\n│ Fitur ini hanya bisa digunakan di Private!\n└───────────────⭓`,

    admin:
      `┌─⭓「 *ADMIN ONLY* 」\n│ Fitur ini hanya untuk Admin group!\n└───────────────⭓`,

    botAdmin:
      `┌─⭓「 *BOT BUKAN ADMIN* 」\n│ Jadikan bot Admin terlebih dahulu!\n└───────────────⭓`,

    block:
      `┌─⭓「 *COMMAND DIBLOKIR* 」\n│ Command ini telah diblokir!\n└───────────────⭓`,

    unreg:
      `┌─⭓「 *BELUM DAFTAR* 」\n│ Ketik *.daftar nama.umur* untuk mendaftar!\n└───────────────⭓`,
  }

  if (!msgs[type]) {
    return false
  }

  try {
    await conn.sendMessage(
      m.chat,
      {
        text: msgs[type],

        contextInfo: {
          externalAdReply: {
            title:
              'Access Denied!',

            body:
              global.wm || '',

            thumbnailUrl:
              global.thumb,

            mediaType: 1,

            renderLargerThumbnail:
              false,
          },
        },
      },
      {
        quoted: m,
      }
    )
  } catch (error) {
    console.error(
      '[DFAIL ERROR]',
      formatError(error)
    )
  }

  return true
}

/* =========================================================
   KEEP BOT ONLINE PERIODICALLY
========================================================= */

let onlineInterval = null

function startOnlineLoop(conn) {
  try {
    if (onlineInterval) {
      clearInterval(onlineInterval)
    }

    onlineInterval =
      setInterval(async () => {
        try {
          await keepOnline(conn)
        } catch {}
      }, 20000)

  } catch {}
}

/*
 * يبدأ تلقائيًا عند تحميل handler
 */
try {
  if (global.conn) {
    startOnlineLoop(global.conn)
  }
} catch {}