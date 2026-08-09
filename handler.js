import {
  getAggregateVotesInPollMessage,
  proto,
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  jidNormalizedUser,
  WAMessageStubType,
  downloadContentFromMessage,
} from '@whiskeysockets/baileys';

import { smsg } from './lib/serialize.js';
import initDatabase from './lib/database.js';
import printMsg from './lib/print.js';
import moment from 'moment-timezone';
import fs from 'fs';
import util from 'util';
import chalk from 'chalk';

const isNumber = (x) =>
  typeof x === 'number' && !isNaN(x);

const delay = (ms) =>
  isNumber(ms) &&
  new Promise((resolve) => setTimeout(resolve, ms));


/* ══════════════════════════════════════
   HELPERS
══════════════════════════════════════ */

/*
 * استخراج رقم / JID بشكل آمن
 */
function cleanNumber(jid = '') {
  return String(jid)
    .split('@')[0]
    .replace(/[^0-9]/g, '');
}


/*
 * تحويل أي صيغة owner إلى رقم
 */
function ownerNumber(owner) {
  if (Array.isArray(owner)) {
    owner = owner[0];
  }

  return String(owner || '')
    .replace(/[^0-9]/g, '');
}


/*
 * التأكد من وجود user database
 */
function ensureUser(jid) {
  if (!jid) return null;

  if (!global.db.data.users[jid]) {
    global.db.data.users[jid] = {
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
    };
  }

  return global.db.data.users[jid];
}


/*
 * التأكد من وجود chat database
 */
function ensureChat(jid) {
  if (!jid) return null;

  if (!global.db.data.chats[jid]) {
    global.db.data.chats[jid] = {
      welcome: true,
      detect: true,
      sWelcome: '',
      sBye: '',
      sPromote: '',
      sDemote: '',
      whitelist: false,
      isBanned: false,
      mute: false,
      member: [],
      chat: 0,
    };
  }

  return global.db.data.chats[jid];
}


/*
 * تحويل الخطأ إلى نص واضح.
 *
 * مهم جدًا:
 * الـ plugin قد يستعمل:
 *
 * throw new Error('...')
 *
 * أو:
 *
 * throw '...'
 *
 * أو:
 *
 * throw { message: '...' }
 *
 * لذلك لا نعتمد على e.name فقط.
 */
function formatPluginError(error) {
  if (error == null) {
    return 'Unknown error';
  }

  if (error instanceof Error) {
    return error.stack ||
      error.message ||
      String(error);
  }

  if (typeof error === 'string') {
    return error;
  }

  if (typeof error === 'object') {
    if (error.stack) {
      return String(error.stack);
    }

    if (error.message) {
      return String(error.message);
    }

    try {
      return util.inspect(error, {
        depth: 8,
        colors: false,
      });
    } catch {
      return String(error);
    }
  }

  return String(error);
}


/*
 * قص الخطأ حتى لا يرفض WhatsApp رسالة ضخمة
 */
function limitErrorText(text, max = 5000) {
  text = String(text || '');

  if (text.length <= max) {
    return text;
  }

  return (
    text.slice(0, max) +
    '\n\n... [ERROR TRUNCATED]'
  );
}


/* ══════════════════════════════════════
   RESTORE QUOTED MESSAGE
══════════════════════════════════════ */

/*
 * بعض نسخ serialize.js لا تنشئ m.quoted
 * بشكل صحيح مع رسائل LID / WhatsApp الحديثة.

 * هذه الدالة تستخرج quotedMessage مباشرة
 * من contextInfo.

 * الهدف:
 *
 * m.quoted
 * m.quoted.mimetype
 * m.quoted.msg
 * m.quoted.download()
 *
 * تعمل بدون تعديل الـ plugins.
 */
async function restoreQuotedMessage(conn, m) {
  try {
    if (!m?.message) {
      return m;
    }

    /*
     * إذا serialize.js أنشأ quoted بالفعل
     * فلا نلمسه.
     */
    if (m.quoted) {
      /*
       * بعض serializers تنشئ quoted
       * ولكن بدون mimetype.
       *
       * إذا كان صالحًا نتركه.
       */
      if (
        typeof m.quoted.download === 'function' ||
        m.quoted.mimetype ||
        m.quoted.msg
      ) {
        return m;
      }
    }

    let contextInfo = null;

    /*
     * الرسائل النصية
     */
    if (
      m.message.extendedTextMessage?.contextInfo
    ) {
      contextInfo =
        m.message.extendedTextMessage.contextInfo;
    }

    /*
     * البحث في جميع أنواع الرسائل
     */
    if (!contextInfo) {
      for (const type of Object.keys(m.message)) {
        const msg = m.message[type];

        if (msg?.contextInfo) {
          contextInfo = msg.contextInfo;
          break;
        }
      }
    }

    if (!contextInfo?.quotedMessage) {
      return m;
    }

    const quotedMessage =
      contextInfo.quotedMessage;

    /*
     * معرفة الرسالة الحقيقية داخل quotedMessage
     */
    let quotedType = null;
    let quotedContent = null;

    for (const [type, content] of Object.entries(
      quotedMessage
    )) {
      if (!content) continue;

      if (
        type === 'messageContextInfo' ||
        type === 'senderKeyDistributionMessage'
      ) {
        continue;
      }

      quotedType = type;
      quotedContent = content;
      break;
    }

    /*
     * viewOnce
     */
    if (
      quotedType === 'viewOnceMessage' ||
      quotedType === 'viewOnceMessageV2' ||
      quotedType === 'viewOnceMessageV2Extension'
    ) {
      const inner =
        quotedContent?.message || {};

      for (const [type, content] of Object.entries(
        inner
      )) {
        if (!content) continue;

        quotedType = type;
        quotedContent = content;
        break;
      }
    }

    /*
     * بعض الرسائل تأتي داخل ephemeralMessage
     */
    if (
      quotedType === 'ephemeralMessage'
    ) {
      const inner =
        quotedContent?.message || {};

      for (const [type, content] of Object.entries(
        inner
      )) {
        if (!content) continue;

        quotedType = type;
        quotedContent = content;
        break;
      }
    }

    if (!quotedType || !quotedContent) {
      return m;
    }

    /*
     * MIME
     */
    let mimetype =
      quotedContent.mimetype || '';

    if (!mimetype) {
      switch (quotedType) {
        case 'audioMessage':
          mimetype = 'audio/ogg';
          break;

        case 'videoMessage':
          mimetype = 'video/mp4';
          break;

        case 'imageMessage':
          mimetype = 'image/jpeg';
          break;

        case 'stickerMessage':
          mimetype = 'image/webp';
          break;

        default:
          mimetype = '';
      }
    }

    /*
     * نوع media المطلوب للتحميل
     */
    let downloadType = null;

    switch (quotedType) {
      case 'audioMessage':
        downloadType = 'audio';
        break;

      case 'videoMessage':
        downloadType = 'video';
        break;

      case 'imageMessage':
        downloadType = 'image';
        break;

      case 'stickerMessage':
        downloadType = 'sticker';
        break;

      case 'documentMessage':
        downloadType = 'document';
        break;
    }

    /*
     * JID صاحب الرسالة المقتبس منها
     */
    const quotedParticipant =
      contextInfo.participant ||
      contextInfo.remoteJid ||
      m.sender;

    const quotedKey = {
      remoteJid: m.chat,
      fromMe:
        !!conn?.user?.id &&
        quotedParticipant === conn.user.id,
      id: contextInfo.stanzaId,
      participant: quotedParticipant,
    };

    /*
     * object الخاص بـ m.quoted
     */
    const quoted = {
      key: quotedKey,

      id:
        contextInfo.stanzaId,

      chat:
        m.chat,

      sender:
        quotedParticipant,

      fromMe:
        quotedKey.fromMe,

      type:
        quotedType,

      mtype:
        quotedType,

      mediaType:
        quotedType,

      mimetype:

        mimetype,

      fileName:
        quotedContent.fileName || '',

      caption:
        quotedContent.caption || '',

      text:
        quotedContent.caption ||
        quotedContent.text ||
        '',

      msg:
        quotedContent,

      message:
        quotedMessage,

      vM:
        quotedContent,

      /*
       * مهم:
       *
       * q.download()
       */
      download: async function () {
        if (
          !downloadType ||
          !quotedContent
        ) {
          throw new Error(
            'الرسالة المقتبس منها لا تحتوي على Media قابلة للتحميل'
          );
        }

        try {
          const stream =
            await downloadContentFromMessage(
              quotedContent,
              downloadType
            );

          const chunks = [];

          for await (const chunk of stream) {
            chunks.push(chunk);
          }

          return Buffer.concat(chunks);
        } catch (error) {
          throw new Error(
            `فشل تحميل الـ Media: ${
              formatPluginError(error)
            }`
          );
        }
      },

      fakeObj: {
        key: quotedKey,
        message: quotedMessage,
      },
    };

    m.quoted = quoted;

    return m;

  } catch (error) {
    console.error(
      '[RESTORE QUOTED ERROR]',
      error
    );

    return m;
  }
}


/* ══════════════════════════════════════
   KEEP BOT ONLINE
══════════════════════════════════════ */

/*
 * محاولة جعل البوت يظهر Online.
 *
 * يتم استدعاؤها عند وصول رسالة.
 */
async function keepOnline(conn) {
  try {
    if (
      typeof conn.sendPresenceUpdate ===
      'function'
    ) {
      await conn.sendPresenceUpdate(
        'available'
      );
    }
  } catch {}
}


/* ══════════════════════════════════════
   MARK MESSAGE AS READ
══════════════════════════════════════ */

async function markMessageRead(conn, m) {
  try {
    if (!m?.key) return;

    /*
     * قراءة جميع الرسائل:
     * الخاص + المجموعات
     */
    if (
      typeof conn.readMessages ===
      'function'
    ) {
      await conn.readMessages([
        m.key,
      ]);
    }

  } catch (error) {
    console.error(
      '[READ ERROR]',
      error
    );
  }
}


/* ══════════════════════════════════════
   SEND PLUGIN ERROR
══════════════════════════════════════ */

async function sendPluginError(
  conn,
  m,
  error
) {
  const errorText =
    limitErrorText(
      formatPluginError(error)
    );

  const pluginName =
    m?.plugin ||
    'Unknown Plugin';

  const command =
    m?.command ||
    'Unknown';

  const sender =
    m?.sender ||
    'Unknown';

  const chat =
    m?.chat ||
    'Unknown';

  /*
   * رسالة للمستخدم
   */
  const userMessage =
`*[ BOT ERROR ]*

*Plugin:* ${pluginName}
*Command:* ${command}
*From:* ${sender}
*Chat:* ${chat}

*Error:*
\`\`\`
${errorText}
\`\`\``;

  try {
    if (m?.chat) {
      await conn.sendMessage(
        m.chat,
        {
          text: userMessage,
        },
        {
          quoted: m,
        }
      );
    }
  } catch (sendError) {
    console.error(
      '[SEND ERROR MESSAGE ERROR]',
      sendError
    );
  }

  /*
   * أيضًا Console
   */
  console.error(
    chalk.red(
      '\n========== BOT ERROR =========='
    )
  );

  console.error(
    'Plugin:',
    pluginName
  );

  console.error(
    'Command:',
    command
  );

  console.error(
    'From:',
    sender
  );

  console.error(
    'Chat:',
    chat
  );

  console.error(
    error
  );

  console.error(
    chalk.red(
      '================================\n'
    )
  );
}


/* ══════════════════════════════════════
   MAIN HANDLER
══════════════════════════════════════ */

export async function handler(chatUpdate) {
  if (
    global.db.data == null
  ) {
    await global.loadDatabase();
  }

  this.msgqueque =
    this.msgqueque || [];

  if (!chatUpdate) return;

  if (
    !chatUpdate.messages ||
    !chatUpdate.messages.length
  ) {
    return;
  }

  await this.pushMessage(
    chatUpdate.messages
  ).catch((error) => {
    console.error(
      '[pushMessage ERROR]',
      error
    );
  });

  let m =
    chatUpdate.messages[
      chatUpdate.messages.length - 1
    ];

  if (!m) return;

  if (m.key?.fromMe) return;

  if (!m.message) return;

  /*
   * Protocol noise
   */
  if (
    m.message.protocolMessage
  ) {
    return;
  }

  /*
   * Reaction noise
   */
  if (
    m.message.reactionMessage
  ) {
    return;
  }

  /*
   * Online + read
   *
   * نضعها قبل plugin processing
   * حتى تعمل في الخاص والمجموعات.
   */
  await keepOnline(this);

  /*
   * autoread
   *
   * لا نقيده بـ isGroup.
   */
  if (
    global.opts?.autoread
  ) {
    await markMessageRead(
      this,
      m
    );
  }

  try {
    /*
     * Serialize
     */
    m =
      smsg(this, m) || m;

    if (!m) return;

    /*
     * RESTORE QUOTED
     *
     * هذا هو الإصلاح الرئيسي.
     */
    m =
      await restoreQuotedMessage(
        this,
        m
      );

    /*
     * Default stats
     */
    m.exp = 0;

    /*
     * مهم:
     * لا نستهلك limit هنا.
     */
    m.limit = false;

    /*
     * Init database structure
     */
    try {
      initDatabase(m);
    } catch (error) {
      console.error(
        '[initDatabase ERROR]',
        error
      );
    }


    /* ═══════════════════════════════
       SENDER
    ═══════════════════════════════ */

    const rawSender =
      m.sender ||
      m.key?.participant ||
      m.key?.remoteJid ||
      '';

    let senderJid =
      String(rawSender);

    try {
      if (
        senderJid.endsWith('@lid')
      ) {
        senderJid =
          this.getJid
            ? this.getJid(senderJid)
            : this.decodeJid(senderJid);
      } else {
        senderJid =
          this.decodeJid
            ? this.decodeJid(senderJid)
            : senderJid;
      }
    } catch {
      senderJid = rawSender;
    }

    /*
     * fallback
     */
    if (!senderJid) {
      senderJid = rawSender;
    }


    /* ═══════════════════════════════
       ENSURE USER
    ═══════════════════════════════ */

    const userData =
      ensureUser(senderJid);

    /*
     * Ensure chat
     */
    if (m.chat) {
      ensureChat(m.chat);
    }


    /* ═══════════════════════════════
       OWNER DETECTION
    ═══════════════════════════════ */

    const ownerJids = [];

    /*
     * bot account
     */
    try {
      if (this.user?.id) {
        ownerJids.push(
          this.decodeJid
            ? this.decodeJid(
                this.user.id
              )
            : this.user.id
        );
      }
    } catch {}


    /*
     * global owners
     */
    for (
      const owner of (
        global.owner || []
      )
    ) {
      const num =
        ownerNumber(owner);

      if (!num) continue;

      ownerJids.push(
        `${num}@s.whatsapp.net`
      );

      /*
       * دعم LID
       */
      ownerJids.push(
        `${num}@lid`
      );
    }


    /*
     * normalize sender comparisons
     */
    const normalizedSender =
      String(senderJid);

    let isROwner =
      ownerJids.includes(
        normalizedSender
      );

    /*
     * fallback by number
     *
     * مفيد في بعض حالات LID.
     */
    if (!isROwner) {
      const senderNumber =
        cleanNumber(
          normalizedSender
        );

      for (
        const owner of (
          global.owner || []
        )
      ) {
        if (
          senderNumber &&
          senderNumber ===
            ownerNumber(owner)
        ) {
          isROwner = true;
          break;
        }
      }
    }


    const isOwner =
      isROwner ||
      !!m.key?.fromMe ||
      !!m.fromMe;


    const isMods =
      !!userData?.moderator;

    const isPrems =
      !!userData?.premium;

    const isBans =
      !!userData?.banned;

    const isWhitelist =
      !!global.db.data.chats[
        m.chat
      ]?.whitelist;


    /* ═══════════════════════════════
       AUTO OWNER PERMISSIONS
    ═══════════════════════════════ */

    if (isROwner) {
      userData.premium =
        true;

      userData.premiumDate =
        'PERMANENT';

      /*
       * لا نضع limit = PERMANENT
       * لأنه يسبب مشاكل في plugins
       * التي تتوقع رقمًا.
       *
       * نستخدم قيمة كبيرة.
       */
      userData.limit =
        Number.MAX_SAFE_INTEGER;

      userData.moderator =
        true;
    } else if (isPrems) {
      /*
       * Premium لا يحتاج Limit.
       */
      userData.limit =
        Number.MAX_SAFE_INTEGER;
    } else if (isBans) {
      return;
    }


    /* ═══════════════════════════════
       SELF MODE / GC ONLY
    ═══════════════════════════════ */

    if (
      global.selfMode &&
      !isOwner &&
      !isPrems &&
      !isMods &&
      !isWhitelist
    ) {
      return;
    }

    if (
      global.gconly &&
      !m.isGroup &&
      !isOwner
    ) {
      return;
    }


    /* ═══════════════════════════════
       GROUP METADATA
    ═══════════════════════════════ */

    if (m.isGroup) {
      try {
        const meta =
          await this.groupMetadata(
            m.chat
          );

        const members =
          meta.participants.map(
            (a) =>
              a.id ||
              a.phoneNumber
          );

        global.db.data.chats[
          m.chat
        ].member =
          members;

        global.db.data.chats[
          m.chat
        ].chat =
          (
            global.db.data.chats[
              m.chat
            ].chat || 0
          ) + 1;

      } catch {}
    }


    /* ═══════════════════════════════
       QUEUE
    ═══════════════════════════════ */

    if (
      global.opts?.queque &&
      m.text &&
      !(isMods || isPrems)
    ) {
      const queque =
        this.msgqueque;

      const prev =
        queque[
          queque.length - 1
        ];

      queque.push(
        m.id ||
        m.key?.id
      );

      const t =
        setInterval(
          async () => {
            if (
              !queque.includes(
                prev
              )
            ) {
              clearInterval(t);
            } else {
              await delay(
                5000
              );
            }
          },
          5000
        );
    }


    /* ═══════════════════════════════
       USER STATS
    ═══════════════════════════════ */

    userData.online =
      Date.now();

    userData.chat =
      (
        userData.chat || 0
      ) + 1;


    /*
     * قراءة الرسالة مرة ثانية
     * بعد serialize أيضًا.
     *
     * هذا يضمن العمل في الخاص
     * والمجموعات.
     */
    if (
      global.opts?.autoread
    ) {
      await markMessageRead(
        this,
        m
      );
    }


    /*
     * لا توقف bot بسبب nyimak
     */
    if (
      global.opts?.nyimak
    ) {
      return;
    }


    if (
      typeof m.text !== 'string'
    ) {
      m.text = '';
    }


    if (m.isBaileys) {
      return;
    }


    m.exp += Math.ceil(
      Math.random() * 1000
    );


    /* ═══════════════════════════════
       PLUGIN CONTEXT
    ═══════════════════════════════ */

    let usedPrefix;

    const _user =
      userData;


    const groupMetadata =
      (
        m.isGroup
          ? (
              (
                global.store
                  ?.groupMetadata
                  ?.[m.chat]
              ) ||
              (
                await this
                  .groupMetadata(
                    m.chat
                  )
                  .catch(
                    () => null
                  )
              ) ||
              {}
            )
          : {}
      ) || {};


    const participants =
      (
        m.isGroup
          ? groupMetadata.participants
          : []
      ) || [];


    /*
     * LID-aware user JID
     */
    let userJid =
      senderJid;

    try {
      if (this.getJid) {
        userJid =
          this.getJid(
            m.sender
          );
      }
    } catch {}


    /*
     * إذا getJid رجع LID
     * نحاول sender normalized
     */
    if (
      !userJid ||
      userJid.endsWith('@lid')
    ) {
      userJid =
        senderJid;
    }


    const user =
      (
        m.isGroup
          ? participants.find(
              (u) => {
                const id =
                  u?.id || '';

                const phone =
                  u?.phoneNumber ||
                  '';

                let decodedId =
                  id;

                let decodedPhone =
                  phone;

                try {
                  decodedId =
                    this.decodeJid
                      ? this.decodeJid(
                          id
                        )
                      : id;
                } catch {}

                try {
                  decodedPhone =
                    this.decodeJid
                      ? this.decodeJid(
                          phone
                        )
                      : phone;
                } catch {}

                return (
                  decodedId ===
                    userJid ||
                  decodedPhone ===
                    userJid ||
                  id ===
                    m.sender ||
                  phone ===
                    m.sender
                );
              }
            )
          : {}
      ) || {};


    /*
     * Bot participant
     */
    const bot =
      (
        m.isGroup
          ? participants.find(
              (u) => {
                const id =
                  u?.id || '';

                const phone =
                  u?.phoneNumber ||
                  '';

                let decodedId =
                  id;

                let decodedPhone =
                  phone;

                let botJid =
                  this.user?.id ||
                  '';

                try {
                  decodedId =
                    this.decodeJid
                      ? this.decodeJid(
                          id
                        )
                      : id;
                } catch {}

                try {
                  decodedPhone =
                    this.decodeJid
                      ? this.decodeJid(
                          phone
                        )
                      : phone;
                } catch {}

                try {
                  botJid =
                    this.decodeJid
                      ? this.decodeJid(
                          botJid
                        )
                      : botJid;
                } catch {}

                return (
                  decodedId ===
                    botJid ||
                  decodedPhone ===
                    botJid
                );
              }
            )
          : {}
      ) || {};


    const isRAdmin =
      user?.admin ===
        'superadmin';

    const isAdmin =
      isRAdmin ||
      user?.admin === 'admin';

    const isBotAdmin =
      !!bot?.admin;


    /*
     * Update store
     */
    if (
      m.isGroup &&
      groupMetadata.id
    ) {
      if (
        global.store
      ) {
        global.store.groupMetadata =
          global.store.groupMetadata ||
          {};

        global.store.groupMetadata[
          m.chat
        ] =
          groupMetadata;
      }
    }


    /* ═══════════════════════════════
       PLUGINS
    ═══════════════════════════════ */

    for (
      const name in (
        global.plugins || {}
      )
    ) {
      const plugin =
        global.plugins[name];

      if (!plugin) continue;

      if (plugin.disabled) {
        continue;
      }


      /* ═══════════════════════════
         .all()
      ═══════════════════════════ */

      if (
        typeof plugin.all ===
        'function'
      ) {
        try {
          await plugin.all.call(
            this,
            m,
            chatUpdate
          );
        } catch (error) {
          console.error(
            `[Plugin all Error: ${name}]`,
            error
          );
        }
      }


      /* ═══════════════════════════
         PREFIX
      ═══════════════════════════ */

      const str2Regex =
        (str) =>
          String(str).replace(
            /[|\\{}()[\]^$+*?.]/g,
            '\\$&'
          );


      const _prefix =
        plugin.customPrefix
          ? plugin.customPrefix
          : this.prefix
          ? this.prefix
          : global.prefix;


      let match;


      if (
        _prefix instanceof RegExp
      ) {
        /*
         * clone regex حتى لا تتأثر بـ lastIndex
         */
        const flags =
          _prefix.flags;

        const re =
          new RegExp(
            _prefix.source,
            flags
          );

        match = [
          re.exec(m.text),
          re,
        ];

      } else if (
        Array.isArray(_prefix)
      ) {
        const found =
          _prefix
            .map((p) => {
              const re =
                p instanceof RegExp
                  ? new RegExp(
                      p.source,
                      p.flags
                    )
                  : new RegExp(
                      str2Regex(p)
                    );

              return [
                re.exec(m.text),
                re,
              ];
            })
            .find(
              (p) => p[0]
            );

        match =
          found || [
            null,
            null,
          ];

      } else if (
        typeof _prefix ===
        'string'
      ) {
        const re =
          new RegExp(
            str2Regex(_prefix)
          );

        match = [
          re.exec(m.text),
          re,
        ];

      } else {
        match = [
          null,
          null,
        ];
      }


      /* ═══════════════════════════
         BEFORE
      ═══════════════════════════ */

      if (
        typeof plugin.before ===
        'function'
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
            continue;
          }
        } catch (error) {
          /*
           * حتى أخطاء before
           * نعرضها للمستخدم.
           */
          m.plugin =
            name;

          await sendPluginError(
            this,
            m,
            error
          );

          continue;
        }
      }


      /*
       * Plugin يجب أن يكون function
       */
      if (
        typeof plugin !==
        'function'
      ) {
        continue;
      }


      if (!match) {
        continue;
      }


      /*
       * إذا لم يوجد match فعلي
       */
      if (
        !match[0]
      ) {
        /*
         * noprefix plugins
         */
        if (
          !global.opts?.noprefix
        ) {
          continue;
        }
      }


      /* ═══════════════════════════
         PREFIX RESULT
      ═══════════════════════════ */

      const result =
        (
          (
            global.opts?.multiprefix ??
            true
          ) &&
          (
            match[0] || ''
          )[0]
        ) ||
        (
          global.opts?.noprefix
            ? null
            : (
                match[0] || ''
              )[0]
        );


      usedPrefix =
        result;


      /* ═══════════════════════════
         NO PREFIX
      ═══════════════════════════ */

      let noPrefix;


      if (isOwner) {
        noPrefix =
          !result
            ? m.text
            : m.text.replace(
                result,
                ''
              );
      } else {
        noPrefix =
          !result
            ? ''
            : m.text
                .replace(
                  result,
                  ''
                )
                .trim();
      }


      let [
        command,
        ...args
      ] =
        noPrefix
          .trim()
          .split(/\s+/)
          .filter(Boolean);


      args =
        args || [];


      const _args =
        noPrefix
          .trim()
          .split(/\s+/)
          .slice(1);


      const text =
        _args.join(' ');


      command =
        (
          command || ''
        ).toLowerCase();


      const fail =
        plugin.fail ||
        global.dfail;


      /* ═══════════════════════════
         COMMAND
      ═══════════════════════════ */

      const prefixCommand =
        !result
          ? (
              plugin.customPrefix ||
              plugin.command
            )
          : plugin.command;


      let isAccept =
        false;


      if (
        prefixCommand instanceof
        RegExp
      ) {
        /*
         * clone regex
         */
        const re =
          new RegExp(
            prefixCommand.source,
            prefixCommand.flags
          );

        isAccept =
          re.test(command);

      } else if (
        Array.isArray(
          prefixCommand
        )
      ) {
        isAccept =
          prefixCommand.some(
            (c) => {
              if (
                c instanceof RegExp
              ) {
                const re =
                  new RegExp(
                    c.source,
                    c.flags
                  );

                return re.test(
                  command
                );
              }

              return (
                c === command
              );
            }
          );

      } else if (
        typeof prefixCommand ===
        'string'
      ) {
        isAccept =
          prefixCommand ===
          command;
      }


      m.prefix =
        !!result;

      usedPrefix =
        !result
          ? ''
          : result;


      if (!isAccept) {
        continue;
      }


      /* ═══════════════════════════
         COMMAND META
      ═══════════════════════════ */

      m.plugin =
        name;

      m.chatUpdate =
        chatUpdate;

      m.command =
        command;

      m.isCommand =
        true;


      /* ═══════════════════════════
         CHAT GUARDS
      ═══════════════════════════ */

      const chatData =
        global.db.data.chats[
          m.chat
        ];


      if (
        chatData?.isBanned &&
        !isOwner
      ) {
        return;
      }


      if (
        chatData?.mute &&
        !isAdmin &&
        !isOwner
      ) {
        return;
      }


      /* ═══════════════════════════
         BLOCK COMMAND
      ═══════════════════════════ */

      if (
        global.db.data.settings
          ?.blockcmd
          ?.includes(command)
      ) {
        if (
          typeof global.dfail ===
          'function'
        ) {
          await global.dfail(
            'block',
            m,
            this
          );
        }

        continue;
      }


      /* ═══════════════════════════
         PERMISSION
      ═══════════════════════════ */

      if (
        plugin.rowner &&
        !isROwner
      ) {
        await fail(
          'rowner',
          m,
          this
        );

        continue;
      }


      if (
        plugin.owner &&
        !isOwner
      ) {
        await fail(
          'owner',
          m,
          this
        );

        continue;
      }


      if (
        plugin.mods &&
        !isMods
      ) {
        await fail(
          'mods',
          m,
          this
        );

        continue;
      }


      if (
        plugin.premium &&
        !isPrems
      ) {
        await fail(
          'premium',
          m,
          this
        );

        continue;
      }


      if (
        plugin.group &&
        !m.isGroup
      ) {
        await fail(
          'group',
          m,
          this
        );

        continue;
      }


      if (
        plugin.botAdmin &&
        !isBotAdmin
      ) {
        await fail(
          'botAdmin',
          m,
          this
        );

        continue;
      }


      if (
        plugin.admin &&
        !isAdmin
      ) {
        await fail(
          'admin',
          m,
          this
        );

        continue;
      }


      if (
        plugin.private &&
        m.isGroup
      ) {
        await fail(
          'private',
          m,
          this
        );

        continue;
      }


      if (
        plugin.register &&
        !_user.registered
      ) {
        await fail(
          'unreg',
          m,
          this
        );

        continue;
      }


      /* ═══════════════════════════
         LIMIT
      ═══════════════════════════ */

      /*
       * تم حذف:
       *
       * if (_user.limit < 1)
       *   LIMIT HABIS
       *
       * لذلك لن يرسل البوت
       * LIMIT HABIS أبدًا.
       */

      /*
       * Premium / Owner
       * permanent
       */
      if (
        isPrems ||
        isOwner
      ) {
        _user.limit =
          Number.MAX_SAFE_INTEGER;
      }


      /* ═══════════════════════════
         LEVEL
      ═══════════════════════════ */

      if (
        plugin.level &&
        plugin.level >
          (
            _user.level || 0
          )
      ) {
        await this.reply(
          m.chat,
          `*[ LEVEL KURANG ]*\n> Butuh level *${plugin.level}* untuk menggunakan fitur ini.`,
          m
        );

        continue;
      }


      /* ═══════════════════════════
         RESPONSE STAT
      ═══════════════════════════ */

      global.db.data.respon =
        global.db.data.respon ||
        {};


      const now =
        Date.now();


      const stat =
        global.db.data.respon[
          m.command
        ];


      if (stat) {
        stat.total =
          (
            stat.total || 0
          ) + 1;

        stat.last =
          now;

      } else {
        global.db.data.respon[
          m.command
        ] = {
          total: 1,
          success: 0,
          last: now,
          lastSuccess: 0,
        };
      }


      /* ═══════════════════════════
         XP
      ═══════════════════════════ */

      const xp =
        'exp' in plugin
          ? parseInt(
              plugin.exp
            )
          : 17;


      m.exp +=
        isNaN(xp)
          ? 0
          : xp;


      /* ═══════════════════════════
         EXTRA
      ═══════════════════════════ */

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
      };


      /* ═══════════════════════════
         RUN PLUGIN
      ═══════════════════════════ */

      try {
        await plugin.call(
          this,
          m,
          extra
        );


        /*
         * Limit لا يتم خصمه
         * إذا كان Owner/Premium.
         *
         * وبقية المستخدمين:
         * plugin.limit أو true
         */
        if (
          !isPrems &&
          !isOwner
        ) {
          m.limit =
            m.limit ||
            plugin.limit ||
            true;
        }


        const s =
          global.db.data.respon[
            m.command
          ];


        if (s) {
          s.success =
            (
              s.success || 0
            ) + 1;

          s.lastSuccess =
            now;
        }


      } catch (error) {
        /*
         * حفظ الخطأ
         */
        m.error =
          error;

        /*
         * لا نستخدم:
         *
         * if (e && e.name)
         *
         * لأن plugin قد يعمل:
         *
         * throw 'رسالة'
         *
         * وهذا كان سبب المشكلة.
         */

        await sendPluginError(
          this,
          m,
          error
        );


        /*
         * مهم:
         * لا نرسل رسالة
         *
         * [ Sistem ] Terjadi error
         *
         * بعد الآن.
         *
         * الرسالة أعلاه تحتوي الخطأ الحقيقي.
         */
      }


      /* ═══════════════════════════
         AFTER
      ═══════════════════════════ */

      finally {
        if (
          typeof plugin.after ===
          'function'
        ) {
          try {
            await plugin.after.call(
              this,
              m,
              extra
            );
          } catch (error) {
            console.error(
              `[Plugin after Error: ${name}]`,
              error
            );
          }
        }
      }


      /*
       * command found
       */
      break;
    }

  } catch (error) {

    /*
     * Handler نفسه حصل له خطأ.
     */
    console.error(
      chalk.red(
        '[Handler Error]'
      ),
      error
    );

    /*
     * إرسال الخطأ للمحادثة
     * بدل الاحتفاظ به في console فقط.
     */
    try {
      if (m?.chat) {
        await sendPluginError(
          this,
          m,
          error
        );
      }
    } catch {}
  }


  /* ══════════════════════════════
     FINALLY
  ══════════════════════════════ */

  finally {

    /*
     * Queue cleanup
     */
    if (
      global.opts?.queque &&
      m?.text
    ) {
      const id =
        m.id ||
        m.key?.id;

      const idx =
        this.msgqueque.indexOf(
          id
        );

      if (idx !== -1) {
        this.msgqueque.splice(
          idx,
          1
        );
      }
    }


    /* ═══════════════════════════
       EXP / LIMIT
    ═══════════════════════════ */

    if (m) {
      try {

        const rawSender =
          m.sender ||
          m.key?.participant ||
          m.key?.remoteJid ||
          '';

        let finalSenderJid =
          rawSender;


        try {
          if (
            finalSenderJid.endsWith(
              '@lid'
            )
          ) {
            finalSenderJid =
              this.getJid
                ? this.getJid(
                    finalSenderJid
                  )
                : this.decodeJid(
                    finalSenderJid
                  );
          } else if (
            this.decodeJid
          ) {
            finalSenderJid =
              this.decodeJid(
                finalSenderJid
              );
          }
        } catch {}


        const u =
          global.db.data.users[
            finalSenderJid
          ];


        if (u) {

          /*
           * XP
           */
          u.exp =
            (
              u.exp || 0
            ) +
            (
              m.exp || 0
            );


          /*
           * Limit:
           *
           * لا نخصم من Owner/Premium.
           */
          if (
            m.limit &&
            !u.premium &&
            finalSenderJid !==
              m.sender
          ) {
            /*
             * لا شيء هنا
             *
             * هذه الحالة نتركها
             * للـ premium/owner logic.
             */
          }


          /*
           * المستخدم العادي
           */
          if (
            m.limit &&
            !u.premium
          ) {
            /*
             * لا تجعل limit سالبًا
             */
            if (
              typeof u.limit ===
              'number'
            ) {
              u.limit =
                Math.max(
                  0,
                  u.limit - 1
                );
            }
          }
        }

      } catch (error) {
        console.error(
          '[Handler] Error updating user data:',
          error
        );
      }
    }


    /*
     * Print message
     */
    try {
      printMsg(
        m,
        this
      );
    } catch {}
  }
}


/* ══════════════════════════════════════
   PARTICIPANTS UPDATE
   WELCOME / BYE / PROMOTE / DEMOTE
══════════════════════════════════════ */

export async function participantsUpdate({
  id,
  participants,
  action,
}) {

  if (
    global.db.data == null
  ) {
    await global.loadDatabase();
  }


  const chat =
    ensureChat(id);


  switch (action) {

    /* ═══════════════════════════
       ADD / REMOVE
    ═══════════════════════════ */

    case 'add':
    case 'remove': {

      if (
        chat.welcome === false
      ) {
        return;
      }


      let meta;


      try {
        meta =
          await this.groupMetadata(
            id
          );
      } catch {
        break;
      }


      for (
        const user of (
          participants || []
        )
      ) {

        /*
         * WhatsApp الجديد:
         *
         * {
         *   id: "...@lid",
         *   phoneNumber: "...@s.whatsapp.net",
         *   admin: null
         * }
         */
        const rawId =
          user?.phoneNumber ||
          user?.id ||
          user;


        let userJid =
          String(rawId || '');


        try {
          userJid =
            this.getJid
              ? this.getJid(
                  userJid
                )
              : this.decodeJid(
                  userJid
                );
        } catch {}


        /*
         * إذا بقي LID
         */
        if (
          userJid.endsWith(
            '@lid'
          )
        ) {
          if (
            user?.phoneNumber
          ) {
            userJid =
              user.phoneNumber;
          } else {
            userJid =
              rawId;
          }
        }


        const userNumber =
          cleanNumber(
            userJid
          );


        const gpname =
          meta.subject ||
          'Unknown Group';


        const member =
          meta.participants
            ?.length ||
          0;


        const time =
          moment
            .tz(
              'Asia/Jakarta'
            )
            .format(
              'HH:mm:ss'
            );


        /*
         * Profile picture
         */
        let pp =
          global.icon;


        try {
          pp =
            await this.profilePictureUrl(
              userJid,
              'image'
            );
        } catch {}


        const defaultText =
          action === 'add'

            ? `┌─⭓「 *WELCOME* 」\n│ *User:* @user\n│ *Group:* ${gpname}\n│ *Member:* ${member}\n│ *Waktu:* ${time}\n└───────────────⭓\nSelamat datang!`

            : `┌─⭓「 *GOODBYE* 」\n│ *User:* @user\n│ *Group:* ${gpname}\n│ *Member:* ${member}\n│ *Waktu:* ${time}\n└───────────────⭓\nSampai jumpa!`;


        let text =
          action === 'add'
            ? (
                chat.sWelcome ||
                defaultText
              )
            : (
                chat.sBye ||
                defaultText
              );


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
              meta.desc ||
              '-'
            );


        try {

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
                    action ===
                    'add'
                      ? 'Welcome notification!'
                      : 'Goodbye, notification!',

                  body:
                    global.wm,

                  thumbnailUrl:
                    pp,

                  mediaType: 1,

                  renderLargerThumbnail:
                    true,
                },
              },
            }
          );

        } catch (error) {