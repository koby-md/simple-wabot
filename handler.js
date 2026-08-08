import {
  getAggregateVotesInPollMessage,
  proto,
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  jidNormalizedUser,
  WAMessageStubType,
} from '@whiskeysockets/baileys';

import { smsg } from './lib/serialize.js';
import initDatabase from './lib/database.js';
import printMsg from './lib/print.js';

import moment from 'moment-timezone';
import fs from 'fs';
import util from 'util';
import chalk from 'chalk';


/* ══════════════════════════════════════
   HELPERS
══════════════════════════════════════ */

const isNumber = (x) =>
  typeof x === 'number' && !isNaN(x);

const delay = (ms) =>
  isNumber(ms) &&
  new Promise((resolve) =>
    setTimeout(resolve, ms)
  );


/*
 * تحويل أي نوع من الأخطاء إلى نص مفهوم.
 *
 * يدعم:
 *
 * throw 'hello'
 * throw new Error('hello')
 * throw { error: 'hello' }
 * FFmpeg errors
 * Baileys errors
 * أخطاء JSON
 */
function formatError(error) {
  try {
    if (error instanceof Error) {
      return error.stack ||
        error.message ||
        String(error);
    }

    if (typeof error === 'string') {
      return error;
    }

    if (typeof error === 'number' ||
        typeof error === 'boolean') {
      return String(error);
    }

    if (error === null) {
      return 'null';
    }

    if (error === undefined) {
      return 'undefined';
    }

    try {
      return JSON.stringify(
        error,
        null,
        2
      );
    } catch {
      return util.format(error);
    }

  } catch {
    return String(error);
  }
}


/*
 * الحصول على رقم الـ owner مهما كان
 * شكل global.owner
 */
function getOwnerNumber(owner) {
  const value =
    Array.isArray(owner)
      ? owner[0]
      : owner;

  return String(value || '')
    .replace(/[^0-9]/g, '');
}


/*
 * تحويل sender إلى JID عادي.
 */
function normalizeSender(conn, sender) {
  if (!sender) return '';

  try {
    if (
      sender.endsWith('@lid')
    ) {
      return conn.getJid
        ? conn.getJid(sender)
        : conn.decodeJid(sender);
    }

    return conn.decodeJid
      ? conn.decodeJid(sender)
      : sender;

  } catch {
    return sender;
  }
}


/*
 * إرسال تقرير الخطأ إلى Owner.
 */
async function reportErrorToOwners(
  conn,
  m,
  errorText
) {
  const owners =
    global.owner || [];

  if (!owners.length) {
    console.error(
      '[ERROR REPORT] global.owner is empty'
    );

    return;
  }

  const report =
`*[ BOT ERROR ]*

*Plugin:* ${m?.plugin || 'Unknown'}
*Command:* ${m?.command || 'Unknown'}
*From:* ${m?.sender || 'Unknown'}
*Chat:* ${m?.chat || 'Unknown'}

*Error:*

\`\`\`
${errorText}
\`\`\``;

  for (const owner of owners) {
    try {
      const number =
        getOwnerNumber(owner);

      if (!number) continue;

      let ownerJid =
        `${number}@s.whatsapp.net`;

      /*
       * محاولة الحصول على JID الصحيح
       */
      try {
        if (
          typeof conn.onWhatsApp ===
          'function'
        ) {
          const result =
            await conn.onWhatsApp(
              number
            );

          if (
            result?.[0]?.jid
          ) {
            ownerJid =
              result[0].jid;
          }
        }
      } catch {}

      await conn.sendMessage(
        ownerJid,
        {
          text: report,
        }
      );

    } catch (sendError) {
      console.error(
        '[ERROR REPORT TO OWNER FAILED]',
        sendError
      );
    }
  }
}


/*
 * إرسال الخطأ إلى نفس المحادثة.
 */
async function sendErrorToChat(
  conn,
  m,
  errorText
) {
  if (!m?.chat) return;

  const text =
`*[ BOT ERROR ]*

*Plugin:* ${m.plugin || 'Unknown'}
*Command:* ${m.command || 'Unknown'}

*Error:*

\`\`\`
${errorText}
\`\`\``;

  try {
    await conn.sendMessage(
      m.chat,
      {
        text,
      },
      {
        quoted: m,
      }
    );

  } catch (sendError) {
    console.error(
      '[ERROR MESSAGE FAILED]',
      sendError
    );
  }
}


/*
 * إرسال الخطأ إلى Owner + المحادثة.
 */
async function handlePluginError(
  conn,
  m,
  error
) {
  const errorText =
    formatError(error);

  console.error(
    chalk.red(
      '\n════════ PLUGIN ERROR ════════'
    )
  );

  console.error(
    chalk.red(
      `Plugin: ${m?.plugin || 'Unknown'}`
    )
  );

  console.error(
    chalk.red(
      `Command: ${m?.command || 'Unknown'}`
    )
  );

  console.error(
    chalk.red(errorText)
  );

  console.error(
    chalk.red(
      '══════════════════════════════\n'
    )
  );


  /*
   * إرسال التفاصيل للـ Owner
   */
  await reportErrorToOwners(
    conn,
    m,
    errorText
  );


  /*
   * إرسال التفاصيل للمحادثة
   */
  await sendErrorToChat(
    conn,
    m,
    errorText
  );
}


/* ══════════════════════════════════════
   MAIN HANDLER
══════════════════════════════════════ */

export async function handler(chatUpdate) {

  /*
   * Database
   */
  if (
    global.db.data == null
  ) {
    await global.loadDatabase();
  }


  /*
   * Queue
   */
  this.msgqueque =
    this.msgqueque || [];


  if (!chatUpdate) return;


  /*
   * Push message
   */
  try {
    await this.pushMessage(
      chatUpdate.messages
    );
  } catch (e) {
    console.error(
      '[pushMessage ERROR]',
      e
    );
  }


  let m =
    chatUpdate.messages?.[
      chatUpdate.messages.length - 1
    ];


  if (!m) return;


  if (m.key?.fromMe) {
    return;
  }


  if (!m.message) {
    return;
  }


  /*
   * تجاهل protocol messages
   */
  if (
    m.message.protocolMessage
  ) {
    return;
  }


  /*
   * تجاهل reaction messages
   */
  if (
    m.message.reactionMessage
  ) {
    return;
  }


  /*
   * تحويل الرسالة إلى smsg
   */
  try {

    m =
      smsg(this, m) || m;

    if (!m) return;


    m.exp = 0;

    /*
     * لا نستخدم limit لمنع الأوامر.
     */
    m.limit = false;


    /*
     * Database structure
     */
    try {
      initDatabase(m);
    } catch (e) {
      console.error(
        '[Database Init ERROR]',
        e
      );
    }


    /* ══════════════════════════════
       ENSURE USER
    ══════════════════════════════ */

    let senderJid =
      normalizeSender(
        this,
        m.sender
      );


    if (!senderJid) {
      senderJid =
        m.sender;
    }


    /*
     * إنشاء user قبل أي استعمال له.
     */
    if (
      !global.db.data.users[
        senderJid
      ]
    ) {
      global.db.data.users[
        senderJid
      ] = {
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


    /*
     * إنشاء chat إذا لم يكن موجوداً.
     */
    if (
      m.chat &&
      !global.db.data.chats[m.chat]
    ) {
      global.db.data.chats[m.chat] = {};
    }


    /* ══════════════════════════════
       ROLES
    ══════════════════════════════ */

    const ownerJids = [
      this.decodeJid(
        global.conn?.user?.id ||
        this.user?.id ||
        ''
      ),

      ...(global.owner || []).map(
        (a) => {
          const num =
            Array.isArray(a)
              ? a[0]
              : a;

          return (
            String(num)
              .replace(/[^0-9]/g, '') +
            '@s.whatsapp.net'
          );
        }
      ),

      ...(global.owner || []).map(
        (a) => {
          const num =
            Array.isArray(a)
              ? a[0]
              : a;

          return (
            String(num)
              .replace(/[^0-9]/g, '') +
            '@lid'
          );
        }
      ),
    ].filter(Boolean);


    /*
     * owner detection
     *
     * نفحص sender الأصلي
     * وكذلك sender بعد التحويل.
     */
    const rawSender =
      String(m.sender || '');

    const decodedSender =
      normalizeSender(
        this,
        rawSender
      );


    const isROwner =
      ownerJids.includes(
        rawSender
      ) ||
      ownerJids.includes(
        decodedSender
      );


    const isOwner =
      isROwner ||
      m.fromMe;


    const userData =
      global.db.data.users[
        senderJid
      ];


    const isMods =
      userData?.moderator ||
      false;


    const isPrems =
      userData?.premium ||
      false;


    const isBans =
      userData?.banned ||
      false;


    const isWhitelist =
      global.db.data.chats?.[
        m.chat
      ]?.whitelist ||
      false;


    /* ══════════════════════════════
       ALWAYS ONLINE
    ══════════════════════════════ */

    /*
     * إبقاء البوت Available.
     */
    try {
      if (
        typeof this.sendPresenceUpdate ===
        'function'
      ) {
        await this.sendPresenceUpdate(
          'available'
        );
      }
    } catch (e) {
      console.error(
        '[Presence ERROR]',
        e
      );
    }


    /* ══════════════════════════════
       ALWAYS READ
    ══════════════════════════════ */

    /*
     * اقرأ الرسالة في الخاص والمجموعات.
     *
     * لا يوجد شرط m.isGroup هنا.
     */
    try {

      if (
        global.opts?.autoread !== false &&
        typeof this.readMessages ===
        'function'
      ) {
        await this.readMessages([
          m.key
        ]);
      }

    } catch (e) {

      console.error(
        '[AutoRead ERROR]',
        e
      );
    }


    /* ══════════════════════════════
       GROUP METADATA
    ══════════════════════════════ */

    if (m.isGroup) {

      try {

        const meta =
          await this.groupMetadata(
            m.chat
          );

        const members =
          meta.participants.map(
            (a) => a.id
          );

        if (
          global.db.data.chats[
            m.chat
          ]
        ) {

          global.db.data.chats[
            m.chat
          ].member = members;

          global.db.data.chats[
            m.chat
          ].chat =
            (
              global.db.data.chats[
                m.chat
              ].chat || 0
            ) + 1;
        }

      } catch {}
    }


    /* ══════════════════════════════
       OWNER PERMISSIONS
    ══════════════════════════════ */

    if (isROwner) {

      userData.premium =
        true;

      userData.premiumDate =
        'PERMANENT';

      userData.limit =
        'PERMANENT';

      userData.moderator =
        true;

    } else if (isPrems) {

      userData.limit =
        'PERMANENT';

    } else if (
      !isROwner &&
      isBans
    ) {
      return;
    }


    /* ══════════════════════════════
       GLOBAL GUARDS
    ══════════════════════════════ */

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


    /* ══════════════════════════════
       QUEUE
    ══════════════════════════════ */

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

      const messageId =
        m.id ||
        m.key?.id;

      queque.push(
        messageId
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


    /* ══════════════════════════════
       USER STATS
    ══════════════════════════════ */

    userData.online =
      Date.now();

    userData.chat =
      (userData.chat || 0) + 1;


    /*
     * لا nyimak حتى لا يمنع autoread.
     */
    if (
      typeof m.text !==
      'string'
    ) {
      m.text = '';
    }


    if (m.isBaileys) {
      return;
    }


    /*
     * XP
     */
    m.exp +=
      Math.ceil(
        Math.random() * 1000
      );


    /* ══════════════════════════════
       PLUGIN DATA
    ══════════════════════════════ */

    let usedPrefix;

    const _user =
      global.db.data.users[
        senderJid
      ];


    const groupMetadata =
      m.isGroup
        ? (
            global.store
              ?.groupMetadata
              ?.[
                m.chat
              ] ||
            await this
              .groupMetadata(
                m.chat
              )
              .catch(() => null) ||
            {}
          )
        : {};


    const participants =
      m.isGroup
        ? (
            groupMetadata
              .participants ||
            []
          )
        : [];


    /*
     * JID المستخدم.
     */
    const userJid =
      this.getJid
        ? this.getJid(m.sender)
        : senderJid;


    /*
     * Find group user.
     */
    const user =
      m.isGroup
        ? (
            participants.find(
              (u) => {

                const decodedId =
                  this.decodeJid(
                    u.id
                  );

                const decodedPhone =
                  this.decodeJid(
                    u.phoneNumber ||
                    ''
                  );

                return (
                  decodedId ===
                    userJid ||
                  decodedPhone ===
                    userJid
                );
              }
            ) || {}
          )
        : {};


    /*
     * Find bot.
     */
    const bot =
      m.isGroup
        ? (
            participants.find(
              (u) => {

                const decodedId =
                  this.decodeJid(
                    u.id
                  );

                const decodedPhone =
                  this.decodeJid(
                    u.phoneNumber ||
                    ''
                  );

                const botJid =
                  this.decodeJid(
                    this.user?.id ||
                    ''
                  );

                return (
                  decodedId ===
                    botJid ||
                  decodedPhone ===
                    botJid
                );
              }
            ) || {}
          )
        : {};


    const isRAdmin =
      user?.admin ===
        'superadmin' ||
      false;


    const isAdmin =
      isRAdmin ||
      user?.admin ===
        'admin' ||
      false;


    const isBotAdmin =
      !!bot?.admin;


    /*
     * Store metadata
     */
    if (
      m.isGroup &&
      groupMetadata.id
    ) {

      if (!global.store) {
        global.store = {};
      }

      if (!global.store.groupMetadata) {
        global.store.groupMetadata =
          {};
      }

      global.store.groupMetadata[
        m.chat
      ] =
        groupMetadata;
    }


    /* ══════════════════════════════
       PLUGIN LOOP
    ══════════════════════════════ */

    for (
      const name in global.plugins
    ) {

      const plugin =
        global.plugins[name];


      if (!plugin) continue;

      if (plugin.disabled) {
        continue;
      }


      /* ═══════════════════════════
         ALL HOOK
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

        } catch (e) {

          /*
           * حتى أخطاء all()
           * يتم إرسالها.
           */
          m.plugin =
            name;

          await handlePluginError(
            this,
            m,
            e
          );
        }
      }


      /* ═══════════════════════════
         PREFIX
      ═══════════════════════════ */

      const str2Regex =
        (str) =>
          String(str)
            .replace(
              /[|\\{}()[\]^$+*?.]/g,
              '\\$&'
            );


      const _prefix =
        plugin.customPrefix
          ? plugin.customPrefix
          : this.prefix
            ? this.prefix
            : global.prefix;


      let prefixMatches;


      if (
        _prefix instanceof RegExp
      ) {

        /*
         * reset regex state
         */
        _prefix.lastIndex = 0;

        prefixMatches = [
          [
            _prefix.exec(
              m.text
            ),
            _prefix
          ]
        ];

      } else if (
        Array.isArray(_prefix)
      ) {

        prefixMatches =
          _prefix.map(
            (p) => {

              const re =
                p instanceof RegExp
                  ? p
                  : new RegExp(
                      str2Regex(p)
                    );

              re.lastIndex = 0;

              return [
                re.exec(m.text),
                re
              ];
            }
          );

      } else if (
        typeof _prefix ===
        'string'
      ) {

        const re =
          new RegExp(
            str2Regex(_prefix)
          );

        prefixMatches = [
          [
            re.exec(m.text),
            re
          ]
        ];

      } else {

        prefixMatches = [
          [
            [],
            new RegExp()
          ]
        ];
      }


      const match =
        prefixMatches.find(
          (p) => p[0]
        );


      /* ═══════════════════════════
         BEFORE
      ═══════════════════════════ */

      if (
        typeof plugin.before ===
        'function'
      ) {

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
            );


          if (
            beforeResult
          ) {
            continue;
          }

        } catch (e) {

          m.plugin =
            name;

          await handlePluginError(
            this,
            m,
            e
          );

          continue;
        }
      }


      if (
        typeof plugin !==
        'function'
      ) {
        continue;
      }


      if (!match) {
        continue;
      }


      /* ═══════════════════════════
         PREFIX RESULT
      ═══════════════════════════ */

      const result =
        (
          (global.opts?.multiprefix ??
            true) &&
          (match[0] || '')[0]
        ) ||
        (
          global.opts?.noprefix ??
          false
        )
          ? null
          : (match[0] || '')[0];


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
         ACCEPT COMMAND
      ═══════════════════════════ */

      const prefixCommand =
        !result
          ? (
              plugin.customPrefix ||
              plugin.command
            )
          : plugin.command;


      let isAccept = false;


      if (
        prefixCommand instanceof
        RegExp
      ) {

        prefixCommand.lastIndex = 0;

        isAccept =
          prefixCommand.test(
            command
          );

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

                c.lastIndex = 0;

                return c.test(
                  command
                );
              }

              return c ===
                command;
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
         MESSAGE DATA
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

        await global.dfail(
          'block',
          m,
          this
        );

        continue;
      }


      /* ═══════════════════════════
         PERMISSIONS
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
       *
       * لذلك لن تظهر:
       *
       * [ LIMIT HABIS ]
       *
       * ولن يتم منع المستخدم بسبب limit.
       */


      /* ═══════════════════════════
         LEVEL
      ═══════════════════════════ */

      if (
        plugin.level &&
        plugin.level >
          (_user.level || 0)
      ) {

        await this.reply(
          m.chat,

          `*[ LEVEL KURANG ]*
> Butuh level *${plugin.level}* untuk menggunakan fitur ini.`,

          m
        );

        continue;
      }


      /* ═══════════════════════════
         STAT
      ═══════════════════════════ */

      if (
        !global.db.data.respon
      ) {
        global.db.data.respon =
          {};
      }


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
          ? 17
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
         EXECUTE PLUGIN
      ═══════════════════════════ */

      try {

        await plugin.call(
          this,
          m,
          extra
        );


        /*
         * limit لا يزال محفوظاً
         * للـ statistics فقط،
         * لكنه لا يمنع التنفيذ.
         */
        if (!isPrems) {

          m.limit =
            m.limit ||
            plugin.limit ||
            false;
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


      } catch (e) {

        /*
         * أهم جزء في النظام.
         *
         * أي خطأ من أي Plugin
         * يصل هنا.
         */

        m.error =
          e;


        await handlePluginError(
          this,
          m,
          e
        );


      } finally {

        /*
         * after()
         *
         * حتى لو after نفسه فيه خطأ
         * نرسل الخطأ أيضاً.
         */
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

          } catch (e) {

            m.plugin =
              name;

            await handlePluginError(
              this,
              m,
              e
            );
          }
        }
      }


      /*
       * لا تشغل Plugins أخرى
       * لنفس الرسالة.
       */
      break;
    }


  } catch (e) {

    /*
     * أخطاء handler نفسه.
     */

    console.error(
      chalk.red(
        '[HANDLER ERROR]'
      ),
      e
    );


    /*
     * إذا كانت الرسالة موجودة
     * أرسل الخطأ أيضاً.
     */
    if (m) {

      try {

        await handlePluginError(
          this,
          m,
          e
        );

      } catch (reportError) {

        console.error(
          '[Handler Error Report Failed]',
          reportError
        );
      }
    }


  } finally {

    /* ══════════════════════════════
       QUEUE CLEANUP
    ══════════════════════════════ */

    if (
      global.opts?.queque &&
      m?.text
    ) {

      const idx =
        this.msgqueque.indexOf(
          m.id ||
          m.key?.id
        );


      if (idx !== -1) {

        this.msgqueque.splice(
          idx,
          1
        );
      }
    }


    /* ══════════════════════════════
       EXP / LIMIT UPDATE
    ══════════════════════════════ */

    if (m) {

      try {

        const finalSenderJid =
          normalizeSender(
            this,
            m.sender
          );


        const u =
          global.db.data.users[
            finalSenderJid
          ];


        if (u) {

          u.exp =
            (
              Number(u.exp) || 0
            ) +
            (
              Number(m.exp) || 0
            );


          /*
           * لا تخصم limit إذا كان
           * PERMANENT.
           *
           * ويمكنك حذف هذا الجزء
           * بالكامل إذا كنت لا تريد
           * استعمال نظام limits نهائياً.
           */
          if (
            m.limit &&
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

      } catch (e) {

        console.error(
          '[Handler User Update ERROR]',
          e
        );
      }
    }


    /* ══════════════════════════════
       PRINT
    ══════════════════════════════ */

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
══════════════════════════════════════ */

export async function participantsUpdate({
  id,
  participants,
  action
}) {

  if (
    global.db.data == null
  ) {
    await global.loadDatabase();
  }


  const chat =
    global.db.data.chats[
      id
    ] || {};


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

      } catch (e) {

        console.error(
          '[Welcome Metadata ERROR]',
          e
        );

        break;
      }


      for (
        const user of participants
      ) {

        try {

          /*
           * WhatsApp يمكن أن يعيد:
           *
           * { id, phoneNumber }
           *
           * لذلك نعطي phoneNumber
           * الأولوية.
           */

          const rawId =
            user?.phoneNumber ||
            user?.id ||
            user;


          let userJid =
            this.getJid
              ? this.getJid(
                  rawId
                )
              : this.decodeJid(
                  rawId
                );


          /*
           * fallback
           */
          if (
            userJid?.endsWith(
              '@lid'
            )
          ) {

            userJid =
              rawId;
          }


          const userNumber =
            String(userJid)
              .split('@')[0];


          const gpname =
            meta.subject;


          const member =
            meta.participants
              .length;


          const time =
            moment
              .tz(
                'Asia/Jakarta'
              )
              .format(
                'HH:mm:ss'
              );


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

              ? `┌─⭓「 *WELCOME* 」
│ *User:* @user
│ *Group:* ${gpname}
│ *Member:* ${member}
│ *Waktu:* ${time}
└───────────────⭓
Selamat datang!`

              : `┌─⭓「 *GOODBYE* 」
│ *User:* @user
│ *Group:* ${gpname}
│ *Member:* ${member}
│ *Waktu:* ${time}
└───────────────⭓
Sampai jumpa!`;


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
                },
              },
            }
          );


        } catch (e) {

          console.error(
            '[Participants Message ERROR]',
            e
          );
        }
      }

      break;
    }


    /* ═══════════════════════════
       PROMOTE / DEMOTE
    ═══════════════════════════ */

    case 'promote':
    case 'demote': {

      if (
        chat.detect === false
      ) {
        break;
      }


      const rawUser =
        participants?.[0];


      const userJid =
        this.getJid
          ? this.getJid(
              rawUser
            )
          : this.decodeJid(
              rawUser
            );


      const userNumber =
        String(userJid)
          .split('@')[0];


      const text =
        action === 'promote'

          ? (
              chat.sPromote ||
              `@${userNumber} الآن أصبح Admin`
            )

          : (
              chat.sDemote ||
              `@${userNumber} لم يعد Admin`
            );


      try {

        await this.sendMessage(
          id,
          {
            text,

            mentions: [
              userJid
            ],
          }
        );

      } catch (e) {

        console.error(
          '[Promote/Demote ERROR]',
          e
        );
      }


      break;
    }
  }
}


/* ══════════════════════════════════════
   GLOBAL DFAIL
══════════════════════════════════════ */

global.dfail = async (
  type,
  m,
  conn
) => {

  const msgs = {

    owner:
      `┌─⭓「 *OWNER ONLY* 」
│ Fitur ini hanya untuk Owner!
└───────────────⭓`,

    rowner:
      `┌─⭓「 *REAL OWNER ONLY* 」
│ Fitur ini hanya untuk Real Owner!
└───────────────⭓`,

    mods:
      `┌─⭓「 *MODERATOR ONLY* 」
│ Fitur ini hanya untuk Moderator bot!
└───────────────⭓`,

    premium:
      `┌─⭓「 *PREMIUM ONLY* 」
│ Fitur ini hanya untuk pengguna Premium!
└───────────────⭓`,

    group:
      `┌─⭓「 *GROUP ONLY* 」
│ Fitur ini hanya bisa digunakan di Group!
└───────────────⭓`,

    private:
      `┌─⭓「 *PRIVATE ONLY* 」
│ Fitur ini hanya bisa digunakan di Private!
└───────────────⭓`,

    admin:
      `┌─⭓「 *ADMIN ONLY* 」
│ Fitur ini hanya untuk Admin group!
└───────────────⭓`,

    botAdmin:
      `┌─⭓「 *BOT BUKAN ADMIN* 」
│ Jadikan bot Admin terlebih dahulu!
└───────────────⭓`,

    block:
      `┌─⭓「 *COMMAND DIBLOKIR* 」
│ Command ini telah diblokir!
└───────────────⭓`,

    unreg:
      `┌─⭓「 *BELUM DAFTAR* 」
│ Ketik *.daftar nama.umur* untuk mendaftar!
└───────────────⭓`,
  };


  if (!msgs[type]) {
    return;
  }


  try {

    return await conn.sendMessage(

      m.chat,

      {
        text:
          msgs[type],

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
          },
        },
      },

      {
        quoted: m
      }
    );

  } catch (e) {

    console.error(
      '[DFAIL ERROR]',
      e
    );
  }
};