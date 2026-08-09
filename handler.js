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
  typeof x === 'number' && !isNaN(x)

const delay = (ms) =>
  isNumber(ms) &&
  new Promise(resolve => setTimeout(resolve, ms))


/* ══════════════════════════════════════
   SAFE ERROR TEXT
══════════════════════════════════════ */

function getErrorText(error) {
  if (error == null) return 'Unknown error'

  if (typeof error === 'string') {
    return error
  }

  if (error instanceof Error) {
    return error.stack || error.message || String(error)
  }

  try {
    return util.format(error)
  } catch {
    return String(error)
  }
}


/* ══════════════════════════════════════
   GET REAL JID
══════════════════════════════════════ */

function getRealJid(conn, jid) {
  if (!jid) return jid

  try {
    if (conn?.getJid) {
      const result = conn.getJid(jid)

      if (result && typeof result === 'string') {
        return result
      }
    }
  } catch {}

  try {
    if (conn?.decodeJid) {
      return conn.decodeJid(jid)
    }
  } catch {}

  return jid
}


/* ══════════════════════════════════════
   MEDIA / QUOTED NORMALIZER
══════════════════════════════════════ */

function normalizeQuoted(m) {
  try {
    if (!m) return m

    const q = m.quoted

    if (!q) return m

    /*
      بعض إصدارات Baileys تضع الميديا هنا:
      q.msg.mimetype

      وبعضها:
      q.mimetype

      وبعض الرسائل الجديدة:
      q.message.videoMessage.mimetype
      q.message.audioMessage.mimetype
    */

    let mime =
      q.mimetype ||
      q.msg?.mimetype ||
      q.message?.imageMessage?.mimetype ||
      q.message?.videoMessage?.mimetype ||
      q.message?.audioMessage?.mimetype ||
      q.message?.documentMessage?.mimetype ||
      q.message?.stickerMessage?.mimetype ||
      q.message?.documentWithCaptionMessage?.message?.documentMessage?.mimetype ||
      ''

    if (mime) {
      q.mimetype = mime

      if (q.msg && !q.msg.mimetype) {
        q.msg.mimetype = mime
      }
    }

    /*
      نوع الرسالة
    */

    if (!q.mtype) {
      if (q.message?.audioMessage) {
        q.mtype = 'audioMessage'
      } else if (q.message?.videoMessage) {
        q.mtype = 'videoMessage'
      } else if (q.message?.imageMessage) {
        q.mtype = 'imageMessage'
      } else if (q.message?.documentMessage) {
        q.mtype = 'documentMessage'
      } else if (q.message?.stickerMessage) {
        q.mtype = 'stickerMessage'
      }
    }

    /*
      إذا كانت الميديا موجودة داخل q.message
      اجعل q.msg يشير إليها أيضاً.
    */

    if (!q.msg && q.message) {
      q.msg =
        q.message.audioMessage ||
        q.message.videoMessage ||
        q.message.imageMessage ||
        q.message.documentMessage ||
        q.message.stickerMessage ||
        q.message.documentWithCaptionMessage?.message?.documentMessage ||
        null
    }

    /*
      إصلاح download في بعض الحالات
    */

    if (
      typeof q.download !== 'function' &&
      typeof m.downloadQuoted === 'function'
    ) {
      q.download = (...args) =>
        m.downloadQuoted(...args)
    }

    /*
      إذا كان المقتبس Audio/Video
      نتأكد من mimetype مرة أخرى
    */

    if (
      !q.mimetype &&
      (
        q.mtype === 'audioMessage' ||
        q.mtype === 'videoMessage'
      )
    ) {
      q.mimetype =
        q.msg?.mimetype ||
        mime ||
        ''
    }

    return m
  } catch (e) {
    console.error(
      chalk.yellow('[Quoted Normalize Error]'),
      e
    )

    return m
  }
}


/* ══════════════════════════════════════
   KEEP BOT AVAILABLE
══════════════════════════════════════ */

async function keepOnline(conn, chat) {
  try {
    if (typeof conn.sendPresenceUpdate === 'function') {
      await conn.sendPresenceUpdate(
        'available',
        chat || undefined
      )
    }
  } catch {}
}


/* ══════════════════════════════════════
   MAIN HANDLER
══════════════════════════════════════ */

export async function handler(chatUpdate) {

  if (global.db.data == null) {
    await global.loadDatabase()
  }

  this.msgqueque = this.msgqueque || []

  if (!chatUpdate) return

  if (!chatUpdate.messages?.length) return

  /*
    Push messages to store
  */

  try {
    await this.pushMessage(chatUpdate.messages)
  } catch (e) {
    console.error(
      chalk.yellow('[PushMessage Error]'),
      e
    )
  }

  let m =
    chatUpdate.messages[
      chatUpdate.messages.length - 1
    ]

  if (!m) return

  /*
    Ignore bot own messages
  */

  if (m.key?.fromMe) return

  if (!m.message) return

  /*
    Protocol noise
  */

  if (m.message.protocolMessage) return

  if (m.message.reactionMessage) return

  try {

    /*
      Serialize
    */

    m = smsg(this, m) || m

    if (!m) return

    /*
      IMPORTANT:
      Normalize quoted media BEFORE plugins
    */

    normalizeQuoted(m)

    /*
      Always try to stay online
    */

    await keepOnline(this, m.chat)

    /*
      Basic values
    */

    m.exp = 0

    /*
      لا يوجد Limit message بعد الآن
    */

    m.limit = false


    /* ══════════════════════════════════
       DATABASE
    ══════════════════════════════════ */

    try {
      initDatabase(m)
    } catch (e) {
      console.error(
        chalk.yellow('[Database Error]'),
        e
      )
    }


    /* ══════════════════════════════════
       SENDER
    ══════════════════════════════════ */

    let senderJid =
      m.sender?.endsWith('@lid')
        ? getRealJid(this, m.sender)
        : getRealJid(this, m.sender)

    senderJid =
      senderJid ||
      m.sender ||
      m.key?.participant ||
      m.key?.remoteJid


    /* ══════════════════════════════════
       MAKE USER OBJECT FIRST
    ══════════════════════════════════ */

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


    /* ══════════════════════════════════
       OWNER
    ══════════════════════════════════ */

    const ownerJids = [
      getRealJid(
        this,
        global.conn?.user?.id || this.user?.id
      ),

      ...(
        Array.isArray(global.owner)
          ? global.owner
          : []
      ).map(a => {

        const num =
          Array.isArray(a)
            ? a[0]
            : a

        return (
          String(num)
            .replace(/[^0-9]/g, '')
          + '@s.whatsapp.net'
        )
      }),

      ...(
        Array.isArray(global.owner)
          ? global.owner
          : []
      ).map(a => {

        const num =
          Array.isArray(a)
            ? a[0]
            : a

        return (
          String(num)
            .replace(/[^0-9]/g, '')
          + '@lid'
        )
      }),
    ].filter(Boolean)


    const isROwner =
      ownerJids.includes(senderJid) ||
      ownerJids.includes(m.sender) ||
      m.fromMe === true


    const isOwner =
      isROwner ||
      m.fromMe === true


    const isMods =
      global.db.data.users[senderJid]?.moderator ||
      false


    const isPrems =
      global.db.data.users[senderJid]?.premium ||
      false


    const isBans =
      global.db.data.users[senderJid]?.banned ||
      false


    const isWhitelist =
      global.db.data.chats[m.chat]?.whitelist ||
      false


    /* ══════════════════════════════════
       AUTO OWNER PERMISSION
    ══════════════════════════════════ */

    if (isROwner) {

      global.db.data.users[senderJid].premium =
        true

      global.db.data.users[senderJid].premiumDate =
        'PERMANENT'

      global.db.data.users[senderJid].limit =
        'PERMANENT'

      global.db.data.users[senderJid].moderator =
        true
    }


    if (
      isBans &&
      !isROwner
    ) {
      return
    }


    /* ══════════════════════════════════
       GROUP METADATA
    ══════════════════════════════════ */

    if (m.isGroup) {

      try {

        const meta =
          await this.groupMetadata(m.chat)

        if (
          !global.db.data.chats[m.chat]
        ) {
          global.db.data.chats[m.chat] = {}
        }

        const members =
          meta.participants.map(
            a => a.id
          )

        global.db.data.chats[m.chat].member =
          members

        global.db.data.chats[m.chat].chat =
          (
            global.db.data.chats[m.chat].chat ||
            0
          ) + 1

      } catch {}
    }


    /* ══════════════════════════════════
       GUARDS
    ══════════════════════════════════ */

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


    /* ══════════════════════════════════
       QUEUE
    ══════════════════════════════════ */

    if (
      global.opts?.queque &&
      m.text &&
      !(isMods || isPrems)
    ) {

      const queue =
        this.msgqueque

      const prev =
        queue[queue.length - 1]

      queue.push(
        m.id ||
        m.key?.id
      )

      const t =
        setInterval(
          async () => {

            if (!queue.includes(prev)) {
              clearInterval(t)
            } else {
              await delay(5000)
            }

          },
          5000
        )
    }


    /* ══════════════════════════════════
       USER STATS
    ══════════════════════════════════ */

    const userData =
      global.db.data.users[senderJid]


    userData.online =
      Date.now()


    userData.chat =
      (userData.chat || 0) + 1


    /* ══════════════════════════════════
       ALWAYS READ
    ══════════════════════════════════ */

    try {

      /*
        لا نعتمد على opts.autoread.
        إذا كانت الرسالة موجودة، نحاول جعلها مقروءة
        في الخاص والمجموعة.
      */

      if (
        typeof this.readMessages === 'function' &&
        m.key
      ) {
        await this.readMessages([
          m.key
        ])
      }

    } catch (e) {

      console.error(
        chalk.yellow('[Read Error]'),
        e
      )
    }


    /*
      لا توقف البوت بسبب nyimak
    */

    if (
      global.opts?.nyimak
    ) {
      return
    }


    if (
      typeof m.text !== 'string'
    ) {
      m.text = ''
    }


    if (m.isBaileys) {
      return
    }


    m.exp +=
      Math.ceil(
        Math.random() * 1000
      )


    /* ══════════════════════════════════
       PLUGIN PREPARATION
    ══════════════════════════════════ */

    let usedPrefix

    const _user =
      global.db.data.users[senderJid]


    let groupMetadata = {}

    if (m.isGroup) {

      groupMetadata =
        (
          global.store?.groupMetadata?.[m.chat]
        ) ||
        (
          await this.groupMetadata(
            m.chat
          ).catch(() => null)
        ) ||
        {}
    }


    const participants =
      m.isGroup
        ? (
          groupMetadata.participants ||
          []
        )
        : []


    const userJid =
      getRealJid(
        this,
        m.sender
      )


    /* ══════════════════════════════════
       FIND USER IN GROUP
    ══════════════════════════════════ */

    const user =
      (
        m.isGroup
          ? participants.find(u => {

              const decodedId =
                getRealJid(
                  this,
                  u.id
                )

              const decodedPhone =
                getRealJid(
                  this,
                  u.phoneNumber || ''
                )

              return (
                decodedId === userJid ||
                decodedPhone === userJid ||
                u.id === m.sender ||
                u.phoneNumber === m.sender
              )

            })
          : {}
      ) || {}


    /* ══════════════════════════════════
       FIND BOT
    ══════════════════════════════════ */

    const bot =
      (
        m.isGroup
          ? participants.find(u => {

              const decodedId =
                getRealJid(
                  this,
                  u.id
                )

              const decodedPhone =
                getRealJid(
                  this,
                  u.phoneNumber || ''
                )

              const botJid =
                getRealJid(
                  this,
                  this.user?.id
                )

              return (
                decodedId === botJid ||
                decodedPhone === botJid ||
                u.id === this.user?.id
              )

            })
          : {}
      ) || {}


    const isRAdmin =
      user?.admin === 'superadmin'


    const isAdmin =
      isRAdmin ||
      user?.admin === 'admin'


    const isBotAdmin =
      !!bot?.admin


    /* ══════════════════════════════════
       STORE METADATA
    ══════════════════════════════════ */

    if (
      m.isGroup &&
      groupMetadata.id
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


    /* ══════════════════════════════════
       PLUGIN LOOP
    ══════════════════════════════════ */

    for (
      const name in global.plugins
    ) {

      const plugin =
        global.plugins[name]


      if (!plugin) continue

      if (plugin.disabled) continue


      /* ════════════════════════════════
         ALL HOOK
      ════════════════════════════════ */

      if (
        typeof plugin.all === 'function'
      ) {

        try {

          await plugin.all.call(
            this,
            m,
            chatUpdate
          )

        } catch (e) {

          console.error(
            chalk.red(
              `[Plugin All Error] ${name}`
            ),
            e
          )
        }
      }


      /* ════════════════════════════════
         PREFIX
      ════════════════════════════════ */

      const str2Regex =
        str =>
          String(str)
            .replace(
              /[|\\{}()[\]^$+*?.]/g,
              '\\$&'
            )


      const _prefix =
        plugin.customPrefix
          ? plugin.customPrefix
          : this.prefix
            ? this.prefix
            : global.prefix


      let match


      if (
        _prefix instanceof RegExp
      ) {

        _prefix.lastIndex = 0

        const result =
          _prefix.exec(m.text)

        match =
          result
            ? [result, _prefix]
            : null

      } else if (
        Array.isArray(_prefix)
      ) {

        match =
          _prefix
            .map(p => {

              const re =
                p instanceof RegExp
                  ? p
                  : new RegExp(
                      str2Regex(p)
                    )

              re.lastIndex = 0

              return [
                re.exec(m.text),
                re
              ]

            })
            .find(p => p[0])

      } else if (
        typeof _prefix === 'string'
      ) {

        const re =
          new RegExp(
            str2Regex(_prefix)
          )

        match = [
          re.exec(m.text),
          re
        ]

        if (!match[0]) {
          match = null
        }

      } else {

        match = null
      }


      /* ════════════════════════════════
         BEFORE
      ════════════════════════════════ */

      if (
        typeof plugin.before === 'function'
      ) {

        try {

          if (
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
          ) {
            continue
          }

        } catch (e) {

          console.error(
            chalk.red(
              `[Plugin Before Error] ${name}`
            ),
            e
          )

          /*
            نرسل الخطأ الحقيقي
          */

          try {

            await m.reply(
              `❌ *خطأ داخل before للـ Plugin*\n\n` +
              `*Plugin:* ${name}\n\n` +
              `\`\`\`\n${getErrorText(e).slice(0, 3500)}\n\`\`\``
            )

          } catch {}
        }
      }


      if (
        typeof plugin !== 'function'
      ) {
        continue
      }


      if (!match) {
        continue
      }


      /* ════════════════════════════════
         COMMAND
      ════════════════════════════════ */

      const result =
        (
          (global.opts?.multiprefix ?? true) &&
          (match[0] || '')[0]
        ) ||
        (
          (global.opts?.noprefix ?? false)
            ? null
            : (match[0] || '')[0]
        )


      usedPrefix =
        result || ''


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


      let [
        command,
        ...args
      ] =
        noPrefix
          .trim()
          .split(/\s+/)
          .filter(Boolean)


      args =
        args || []


      const _args =
        noPrefix
          .trim()
          .split(/\s+/)
          .slice(1)


      const text =
        _args.join(' ')


      command =
        (command || '')
          .toLowerCase()


      const fail =
        plugin.fail ||
        global.dfail


      const prefixCommand =
        !result
          ? (
              plugin.customPrefix ||
              plugin.command
            )
          : plugin.command


      let isAccept = false


      if (
        prefixCommand instanceof RegExp
      ) {

        prefixCommand.lastIndex = 0

        isAccept =
          prefixCommand.test(
            command
          )

      } else if (
        Array.isArray(prefixCommand)
      ) {

        isAccept =
          prefixCommand.some(c => {

            if (
              c instanceof RegExp
            ) {

              c.lastIndex = 0

              return c.test(
                command
              )
            }

            return c === command
          })

      } else if (
        typeof prefixCommand === 'string'
      ) {

        isAccept =
          prefixCommand === command
      }


      m.prefix =
        !!result


      usedPrefix =
        !result
          ? ''
          : result


      if (!isAccept) {
        continue
      }


      /* ════════════════════════════════
         COMMAND INFO
      ════════════════════════════════ */

      m.plugin =
        name

      m.chatUpdate =
        chatUpdate

      m.command =
        command

      m.isCommand =
        true


      /* ════════════════════════════════
         CHAT GUARDS
      ════════════════════════════════ */

      const chatData =
        global.db.data.chats[m.chat]


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


      /* ════════════════════════════════
         BLOCK COMMAND
      ════════════════════════════════ */

      if (
        global.db.data.settings?.blockcmd?.includes(
          command
        )
      ) {

        await global.dfail(
          'block',
          m,
          this
        )

        continue
      }


      /* ════════════════════════════════
         PERMISSIONS
      ════════════════════════════════ */

      if (
        plugin.rowner &&
        !isROwner
      ) {

        await fail(
          'rowner',
          m,
          this
        )

        continue
      }


      if (
        plugin.owner &&
        !isOwner
      ) {

        await fail(
          'owner',
          m,
          this
        )

        continue
      }


      if (
        plugin.mods &&
        !isMods
      ) {

        await fail(
          'mods',
          m,
          this
        )

        continue
      }


      if (
        plugin.premium &&
        !isPrems
      ) {

        await fail(
          'premium',
          m,
          this
        )

        continue
      }


      if (
        plugin.group &&
        !m.isGroup
      ) {

        await fail(
          'group',
          m,
          this
        )

        continue
      }


      if (
        plugin.botAdmin &&
        !isBotAdmin
      ) {

        await fail(
          'botAdmin',
          m,
          this
        )

        continue
      }


      if (
        plugin.admin &&
        !isAdmin
      ) {

        await fail(
          'admin',
          m,
          this
        )

        continue
      }


      if (
        plugin.private &&
        m.isGroup
      ) {

        await fail(
          'private',
          m,
          this
        )

        continue
      }


      if (
        plugin.register &&
        !_user.registered
      ) {

        await fail(
          'unreg',
          m,
          this
        )

        continue
      }


      /*
        IMPORTANT:
        تم حذف LIMIT HABIS بالكامل.

        لا يوجد:
        LIMIT HABIS
        ولا يتم منع الأمر بسبب limit.
      */


      /* ════════════════════════════════
         LEVEL
      ════════════════════════════════ */

      if (
        plugin.level &&
        plugin.level > _user.level
      ) {

        await this.reply(
          m.chat,
          `*[ LEVEL KURANG ]*\n` +
          `> Butuh level *${plugin.level}* untuk menggunakan fitur ini.`,
          m
        )

        continue
      }


      /* ════════════════════════════════
         STAT
      ════════════════════════════════ */

      if (!global.db.data.respon) {
        global.db.data.respon = {}
      }


      const now =
        Date.now()


      const stat =
        global.db.data.respon[
          m.command
        ]


      if (stat) {

        stat.total =
          (stat.total || 0) + 1

        stat.last =
          now

      } else {

        global.db.data.respon[
          m.command
        ] = {

          total: 1,
          success: 0,
          last: now,
          lastSuccess: 0

        }
      }


      const xp =
        'exp' in plugin
          ? parseInt(plugin.exp)
          : 17


      m.exp +=
        isNaN(xp)
          ? 17
          : xp


      /* ════════════════════════════════
         EXTRA
      ════════════════════════════════ */

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


      /* ════════════════════════════════
         EXECUTE PLUGIN
      ════════════════════════════════ */

      try {

        /*
          Normalize quoted again مباشرة قبل plugin
        */

        normalizeQuoted(m)


        await plugin.call(
          this,
          m,
          extra
        )


        /*
          لا نمنع الأوامر بسبب limit.
        */

        if (!isPrems) {
          m.limit =
            m.limit || false
        }


        const s =
          global.db.data.respon[
            m.command
          ]


        if (s) {

          s.success =
            (s.success || 0) + 1

          s.lastSuccess =
            now
        }


      } catch (e) {

        m.error =
          e


        const errText =
          getErrorText(e)


        console.error(
          chalk.red(
            '[Plugin Error]'
          ),
          {
            plugin: m.plugin,
            command: m.command,
            chat: m.chat,
            sender: m.sender,
            error: errText
          }
        )


        /* ════════════════════════════
           SEND REAL ERROR TO USER
        ════════════════════════════ */

        try {

          await m.reply(
            `${errText.slice(0, 3500)}`
          )

        } catch (replyError) {

          console.error(
            chalk.red(
              '[Error Reply Failed]'
            ),
            replyError
          )
        }


        /* ════════════════════════════
           ALSO REPORT OWNER
        ════════════════════════════ */

        try {

          const owners =
            Array.isArray(global.owner)
              ? global.owner
              : []


          for (
            const owner of owners
          ) {

            try {

              const number =
                Array.isArray(owner)
                  ? owner[0]
                  : owner


              const cleanNumber =
                String(number)
                  .replace(
                    /[^0-9]/g,
                    ''
                  )


              if (!cleanNumber) {
                continue
              }


              const ownerJid =
                cleanNumber +
                '@s.whatsapp.net'


              await this.sendMessage(
                ownerJid,
                {
                  text:
                    `*[ BOT ERROR ]*\n\n` +
                    `*Plugin:* ${m.plugin}\n` +
                    `*Command:* ${usedPrefix}${command}\n` +
                    `*From:* ${m.sender || '-'}\n` +
                    `*Chat:* ${m.chat || '-'}\n\n` +
                    `*Error:*\n` +
                    `\`\`\`\n${errText.slice(0, 3500)}\n\`\`\``
                }
              )

            } catch (
              ownerError
            ) {

              console.error(
                '[Owner Error Report Failed]',
                ownerError
              )
            }
          }

        } catch {}


        /*
          IMPORTANT:
          لا نرسل الرسالة القديمة:
          [ Sistem ] Terjadi error pada bot!
        */

      } finally {

        if (
          typeof plugin.after === 'function'
        ) {

          try {

            await plugin.after.call(
              this,
              m,
              extra
            )

          } catch (e) {

            console.error(
              chalk.red(
                `[Plugin After Error] ${name}`
              ),
              e
            )
          }
        }
      }


      break
    }


  } catch (e) {

    const errorText =
      getErrorText(e)


    console.error(
      chalk.red(
        '[Handler Error]'
      ),
      errorText
    )


    /*
      إذا كان الخطأ من الـ Handler نفسه،
      نحاول إرساله للمستخدم أيضاً.
    */

    try {

      if (m?.chat) {

        await m.reply(
          `*[ HANDLER ERROR ]*\n\n` +
          `\`\`\`\n${errorText.slice(0, 3500)}\n\`\`\``
        )
      }

    } catch {}
  }


  /* ══════════════════════════════════
     FINALLY
  ══════════════════════════════════ */

  finally {

    /*
      Queue cleanup
    */

    try {

      if (
        global.opts?.queque &&
        m?.text
      ) {

        const idx =
          this.msgqueque.indexOf(
            m.id ||
            m.key?.id
          )


        if (idx !== -1) {

          this.msgqueque.splice(
            idx,
            1
          )
        }
      }

    } catch {}


    /* ════════════════════════════════
       EXP UPDATE
    ════════════════════════════════ */

    try {

      if (m) {

        const finalSenderJid =
          getRealJid(
            this,
            m.sender
          )


        const u =
          global.db.data.users[
            finalSenderJid
          ]


        if (u) {

          u.exp =
            (u.exp || 0) +
            (m.exp || 0)


          /*
            لا ننقص Limit
            لأن نظام Limit تم تعطيله
          */

        }
      }

    } catch (e) {

      console.error(
        '[Handler] User update error:',
        e
      )
    }


    /*
      Print
    */

    try {

      printMsg(
        m,
        this
      )

    } catch {}
  }
}


/* ══════════════════════════════════════
   PARTICIPANTS UPDATE
══════════════════════════════════════ */

export async function participantsUpdate({
  id,
  participants,
  action
}) {

  if (
    global.db.data == null
  ) {
    await global.loadDatabase()
  }


  const chat =
    global.db.data.chats[id] ||
    {}


  switch (action) {

    /* ════════════════════════════════
       WELCOME / BYE
    ════════════════════════════════ */

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

      } catch {
        return
      }


      for (
        const user of participants
      ) {

        /*
          Baileys الجديد:

          {
            id: "...@lid",
            phoneNumber: "...@s.whatsapp.net",
            admin: null
          }
        */

        const rawId =
          user?.phoneNumber ||
          user?.id ||
          user


        let userJid =
          getRealJid(
            this,
            rawId
          )


        /*
          إذا بقي LID
        */

        if (
          userJid?.endsWith('@lid')
        ) {

          userJid =
            user?.phoneNumber ||
            rawId
        }


        const userNumber =
          String(userJid)
            .split('@')[0]


        const gpname =
          meta.subject


        const member =
          meta.participants.length


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

            ? `┌─⭓「 *WELCOME* 」\n` +
              `│ *User:* @user\n` +
              `│ *Group:* ${gpname}\n` +
              `│ *Member:* ${member}\n` +
              `│ *Waktu:* ${time}\n` +
              `└───────────────⭓\n` +
              `Selamat datang!`

            : `┌─⭓「 *GOODBYE* 」\n` +
              `│ *User:* @user\n` +
              `│ *Group:* ${gpname}\n` +
              `│ *Member:* ${member}\n` +
              `│ *Waktu:* ${time}\n` +
              `└───────────────⭓\n` +
              `Sampai jumpa!`


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


        try {

          await this.sendMessage(
            id,
            {
              text,

              mentions: [
                userJid
              ],

              contextInfo: {

                mentionedJid: [
                  userJid
                ],

                externalAdReply: {

                  title:
                    action === 'add'
                      ? 'Welcome notification!'
                      : 'Goodbye, notification!',

                  body:
                    global.wm,

                  thumbnailUrl:
                    pp,

                  mediaType: 1,

                  renderLargerThumbnail:
                    true,
                }
              }
            }
          )

        } catch (e) {

          console.error(
            '[Welcome Error]',
            e
          )
        }
      }


      break
    }


    /* ════════════════════════════════
       PROMOTE / DEMOTE
    ════════════════════════════════ */

    case 'promote':
    case 'demote': {

      if (
        chat.detect === false
      ) {
        break
      }


      const user =
        participants[0]


      const rawId =
        user?.phoneNumber ||
        user?.id ||
        user


      const userJid =
        getRealJid(
          this,
          rawId
        )


      const userNumber =
        String(userJid)
          .split('@')[0]


      const text =
        action === 'promote'

          ? (
              chat.sPromote ||
              `@${userNumber} sekarang menjadi Admin`
            )

          : (
              chat.sDemote ||
              `@${userNumber} tidak lagi Admin`
            )


      try {

        await this.sendMessage(
          id,
          {
            text,

            mentions: [
              userJid
            ]
          }
        )

      } catch (e) {

        console.error(
          '[Promote/Demote Error]',
          e
        )
      }


      break
    }
  }
}


/* ══════════════════════════════════════
   DFAIL
══════════════════════════════════════ */

global.dfail = async (
  type,
  m,
  conn
) => {

  const msgs = {

    owner:
      `┌─⭓「 *OWNER ONLY* 」\n` +
      `│ Fitur ini hanya untuk Owner!\n` +
      `└───────────────⭓`,

    rowner:
      `┌─⭓「 *REAL OWNER ONLY* 」\n` +
      `│ Fitur ini hanya untuk Real Owner!\n` +
      `└───────────────⭓`,

    mods:
      `┌─⭓「 *MODERATOR ONLY* 」\n` +
      `│ Fitur ini hanya untuk Moderator bot!\n` +
      `└───────────────⭓`,

    premium:
      `┌─⭓「 *PREMIUM ONLY* 」\n` +
      `│ Fitur ini hanya untuk pengguna Premium!\n` +
      `└───────────────⭓`,

    group:
      `┌─⭓「 *GROUP ONLY* 」\n` +
      `│ Fitur ini hanya bisa digunakan di Group!\n` +
      `└───────────────⭓`,

    private:
      `┌─⭓「 *PRIVATE ONLY* 」\n` +
      `│ Fitur ini hanya bisa digunakan di Private!\n` +
      `└───────────────⭓`,

    admin:
      `┌─⭓「 *ADMIN ONLY* 」\n` +
      `│ Fitur ini hanya untuk Admin group!\n` +
      `└───────────────⭓`,

    botAdmin:
      `┌─⭓「 *BOT BUKAN ADMIN* 」\n` +
      `│ Jadikan bot Admin terlebih dahulu!\n` +
      `└───────────────⭓`,

    block:
      `┌─⭓「 *COMMAND DIBLOKIR* 」\n` +
      `│ Command ini telah diblokir!\n` +
      `└───────────────⭓`,

    unreg:
      `┌─⭓「 *BELUM DAFTAR* 」\n` +
      `│ Ketik *.daftar nama.umur* untuk mendaftar!\n` +
      `└───────────────⭓`,
  }


  if (!msgs[type]) {
    return
  }


  try {

    return await conn.sendMessage(
      m.chat,
      {
        text: msgs[type],

        contextInfo: {

          externalAdReply: {

            title:
              'Access Denied!',

            body:
              global.wm,

            thumbnailUrl:
              global.thumb,

            mediaType: 1,

            renderLargerThumbnail:
              false,
          }
        }
      },
      {
        quoted: m
      }
    )

  } catch (e) {

    console.error(
      '[DFAIL ERROR]',
      e
    )
  }
}