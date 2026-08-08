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
  new Promise((r) => setTimeout(r, ms));


/*
 * تحويل أي Error إلى نص كامل.
 * يدعم:
 *
 * throw 'رسالة'
 * throw new Error('رسالة')
 * FFmpeg Error
 * Baileys Error
 * Objects
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

    if (
      typeof error === 'number' ||
      typeof error === 'boolean'
    ) {
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
 * تحويل owner إلى رقم.
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
 * Normalize sender JID.
 */
function normalizeSender(conn, sender) {
  if (!sender) return '';

  try {
    if (sender.endsWith('@lid')) {
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


/* ══════════════════════════════════════
   ERROR REPORT
══════════════════════════════════════ */

async function sendErrorReport(
  conn,
  m,
  error
) {
  const errorText =
    formatError(error);

  const plugin =
    m?.plugin || 'Unknown';

  const command =
    m?.command || 'Unknown';

  const report =
`*[ BOT ERROR ]*

*Plugin:* ${plugin}
*Command:* ${command}
*From:* ${m?.sender || 'Unknown'}
*Chat:* ${m?.chat || 'Unknown'}

*Error:*

\`\`\`
${errorText}
\`\`\``;


  /*
   * Console
   */
  console.error(
    chalk.red(
      '\n════════════════════════════════'
    )
  );

  console.error(
    chalk.red(
      `[Plugin Error] ${plugin}`
    )
  );

  console.error(
    chalk.red(
      `[Command] ${command}`
    )
  );

  console.error(
    chalk.red(errorText)
  );

  console.error(
    chalk.red(
      '════════════════════════════════\n'
    )
  );


  /*
   * إرسال الخطأ إلى نفس المحادثة.
   */
  if (m?.chat) {
    try {
      await conn.sendMessage(
        m.chat,
        {
          text: report,
        },
        {
          quoted: m,
        }
      );
    } catch (sendError) {
      console.error(
        '[Error Message Send Failed]',
        sendError
      );
    }
  }


  /*
   * إرسال الخطأ إلى الـ Owner.
   */
  for (
    const owner of global.owner || []
  ) {

    try {

      const number =
        getOwnerNumber(owner);

      if (!number) continue;

      let ownerJid =
        `${number}@s.whatsapp.net`;


      /*
       * الحصول على JID الحقيقي
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

    } catch (ownerError) {

      console.error(
        '[Owner Error Report Failed]',
        ownerError
      );
    }
  }
}


/* ══════════════════════════════════════
   MAIN HANDLER
══════════════════════════════════════ */

export async function handler(chatUpdate) {

  if (global.db.data == null) {
    await global.loadDatabase();
  }


  this.msgqueque =
    this.msgqueque || [];


  if (!chatUpdate) return;


  /*
   * Push messages
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
    chatUpdate.messages[
      chatUpdate.messages.length - 1
    ];


  if (!m) return;

  if (m.key.fromMe) return;

  if (!m.message) return;


  /*
   * Ignore protocol messages.
   */
  if (m.message.protocolMessage) {
    return;
  }


  /*
   * Ignore reactions.
   */
  if (m.message.reactionMessage) {
    return;
  }


  try {

    m =
      smsg(this, m) || m;

    if (!m) return;


    m.exp = 0;

    /*
     * لا نستخدم limit لمنع المستخدم.
     */
    m.limit = false;


    /* ══════════════════════════════
       DATABASE
    ══════════════════════════════ */

    try {
      initDatabase(m);
    } catch (e) {
      console.error(
        '[Database Init ERROR]',
        e
      );
    }


    /* ══════════════════════════════
       NORMALIZE SENDER
    ══════════════════════════════ */

    let senderJid =
      m.sender?.endsWith('@lid')
        ? (
            this.getJid
              ? this.getJid(m.sender)
              : this.decodeJid(m.sender)
          )
        : this.decodeJid(m.sender);


    if (!senderJid) {
      senderJid =
        m.sender;
    }


    /* ══════════════════════════════
       CREATE USER
    ══════════════════════════════ */

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
     * Create chat.
     */
    if (
      m.chat &&
      !global.db.data.chats[m.chat]
    ) {

      global.db.data.chats[m.chat] =
        {};
    }


    /* ══════════════════════════════
       ROLES
    ══════════════════════════════ */

    const isROwner = [

      this.decodeJid(
        global.conn.user.id
      ),

      ...global.owner.map(
        (a) => {

          const num =
            Array.isArray(a)
              ? a[0]
              : a;

          return (
            String(num)
              .replace(
                /[^0-9]/g,
                ''
              ) +
            '@s.whatsapp.net'
          );
        }
      ),

      ...global.owner.map(
        (a) => {

          const num =
            Array.isArray(a)
              ? a[0]
              : a;

          return (
            String(num)
              .replace(
                /[^0-9]/g,
                ''
              ) +
            '@lid'
          );
        }
      ),

    ].includes(
      m.sender
    ) ||
    [
      this.decodeJid(
        global.conn.user.id
      ),

      ...global.owner.map(
        (a) => {

          const num =
            Array.isArray(a)
              ? a[0]
              : a;

          return (
            String(num)
              .replace(
                /[^0-9]/g,
                ''
              ) +
            '@s.whatsapp.net'
          );
        }
      ),
    ].includes(
      senderJid
    );


    const isOwner =
      isROwner ||
      m.fromMe;


    const isMods =
      global.db.data.users[
        senderJid
      ]?.moderator ||
      false;


    const isPrems =
      global.db.data.users[
        senderJid
      ]?.premium ||
      false;


    const isBans =
      global.db.data.users[
        senderJid
      ]?.banned ||
      false;


    const isWhitelist =
      global.db.data.chats[
        m.chat
      ]?.whitelist ||
      false;


    /* ══════════════════════════════
       ALWAYS ONLINE
    ══════════════════════════════ */

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
       PRIVATE + GROUP
    ══════════════════════════════ */

    try {

      if (
        typeof this.readMessages ===
        'function'
      ) {

        await this.readMessages([
          m.key
        ]);
      }

    } catch (e) {

      console.error(
        '[ReadMessages ERROR]',
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


    /* ══════════════════════════════
       OWNER PERMISSIONS
    ══════════════════════════════ */

    if (isROwner) {

      global.db.data.users[
        senderJid
      ].premium = true;

      global.db.data.users[
        senderJid
      ].premiumDate =
        'PERMANENT';

      global.db.data.users[
        senderJid
      ].limit =
        'PERMANENT';

      global.db.data.users[
        senderJid
      ].moderator =
        true;

    } else if (isPrems) {

      global.db.data.users[
        senderJid
      ].limit =
        'PERMANENT';

    } else if (
      !isROwner &&
      isBans
    ) {

      return;
    }


    /* ══════════════════════════════
       SELF / GCONLY
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

      queque.push(
        m.id ||
        m.key.id
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
                1000 * 5
              );
            }

          },
          1000 * 5
        );
    }


    /* ══════════════════════════════
       USER STATS
    ══════════════════════════════ */

    global.db.data.users[
      senderJid
    ].online =
      Date.now();


    global.db.data.users[
      senderJid
    ].chat =
      (
        global.db.data.users[
          senderJid
        ].chat || 0
      ) + 1;


    /*
     * لا نستخدم nyimak هنا.
     * حتى لا يمنع الرد.
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


    m.exp +=
      Math.ceil(
        Math.random() * 1000
      );


    /* ══════════════════════════════
       PLUGIN LOOP
    ══════════════════════════════ */

    let usedPrefix;


    const _user =
      global.db.data.users[
        senderJid
      ];


    const groupMetadata =
      (
        m.isGroup
          ? (
              (
                global.store
                  ?.groupMetadata
                  ?.[
                    m.chat
                  ]
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
          ? (
              groupMetadata
                .participants ||
              []
            )
          : []
      ) || [];


    /*
     * FIX JID.
     */
    const userJid =
      this.getJid
        ? this.getJid(
            m.sender
          )
        : senderJid;


    const user =
      (
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
              )
            )
          : {}
      ) || {};


    const bot =
      (
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
                      this.user?.id
                    );

                  return (
                    decodedId ===
                      botJid ||
                    decodedPhone ===
                      botJid
                  );
                }
              )
            )
          : {}
      ) || {};


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
     * Update store.
     */
    if (
      m.isGroup &&
      groupMetadata.id
    ) {

      if (!global.store) {
        global.store = {};
      }

      if (
        !global.store.groupMetadata
      ) {

        global.store.groupMetadata =
          {};
      }


      global.store.groupMetadata[
        m.chat
      ] =
        groupMetadata;
    }


    /* ══════════════════════════════
       PLUGINS
    ══════════════════════════════ */

    for (
      const name in global.plugins
    ) {

      let plugin =
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

        } catch (e) {

          /*
           * all() error
           */
          m.plugin =
            name;

          await sendErrorReport(
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
          str.replace(
            /[|\\{}()[\]^$+*?.]/g,
            '\\$&'
          );


      const _prefix =
        plugin.customPrefix
          ? plugin.customPrefix
          : this.prefix
            ? this.prefix
            : global.prefix;


      /*
       * هذا هو منطق الـ prefix
       * الأصلي من ملفك.
       *
       * لا نغيّره.
       */

      const match = (
        _prefix instanceof RegExp

          ? [
              [
                _prefix.exec(
                  m.text
                ),
                _prefix
              ]
            ]

          : Array.isArray(
              _prefix
            )

            ? _prefix.map(
                (p) => {

                  const re =
                    p instanceof RegExp
                      ? p
                      : new RegExp(
                          str2Regex(p)
                        );

                  return [
                    re.exec(
                      m.text
                    ),
                    re
                  ];
                }
              )

            : typeof _prefix ===
              'string'

              ? [
                  [
                    new RegExp(
                      str2Regex(
                        _prefix
                      )
                    ).exec(
                      m.text
                    ),

                    new RegExp(
                      str2Regex(
                        _prefix
                      )
                    )
                  ]
                ]

              : [
                  [
                    [],
                    new RegExp()
                  ]
                ]

      ).find(
        (p) => p[1]
      );


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

        } catch (e) {

          m.plugin =
            name;

          await sendErrorReport(
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
          (global.opts?.noprefix ??
            false)
            ? null
            : (match[0] || '')[0]
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
         COMMAND CHECK
      ═══════════════════════════ */

      const prefixCommand =
        !result
          ? (
              plugin.customPrefix ||
              plugin.command
            )
          : plugin.command;


      const isAccept =
        (
          prefixCommand instanceof
          RegExp &&
          prefixCommand.test(
            command
          )
        ) ||

        (
          Array.isArray(
            prefixCommand
          ) &&
          prefixCommand.some(
            (c) =>
              c instanceof RegExp
                ? c.test(
                    command
                  )
                : c === command
          )
        ) ||

        (
          typeof prefixCommand ===
          'string' &&
          prefixCommand ===
          command
        );


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
         COMMAND DATA
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
         CHAT / MUTE
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


      /*
       * مهم:
       *
       * تم حذف Limit check.
       *
       * لا يوجد:
       *
       * LIMIT HABIS
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
         STAT TRACKER
      ═══════════════════════════ */

      const now =
        Date.now();


      if (
        !global.db.data.respon
      ) {

        global.db.data.respon =
          {};
      }


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
         EXP
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
         * لا نمنع الأمر بسبب limit.
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


        s.success =
          (
            s.success || 0
          ) + 1;


        s.lastSuccess =
          now;


      } catch (e) {

        /*
         * أي خطأ من Plugin
         * يصل هنا.
         *
         * لا نرسل:
         *
         * Terjadi error pada bot!
         *
         * بل نرسل الخطأ الحقيقي.
         */

        m.error =
          e;


        await sendErrorReport(
          this,
          m,
          e
        );

      } finally {

        /*
         * AFTER
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

            /*
             * حتى خطأ after
             * يظهر للمستخدم.
             */

            m.plugin =
              name;

            await sendErrorReport(
              this,
              m,
              e
            );
          }
        }
      }


      break;
    }


  } catch (e) {

    /* ══════════════════════════════
       HANDLER ERROR
    ══════════════════════════════ */

    console.error(
      chalk.red(
        '[Handler Error]'
      ),
      e
    );


    /*
     * إرسال الخطأ الحقيقي
     * إذا كانت الرسالة موجودة.
     */

    if (m) {

      try {

        await sendErrorReport(
          this,
          m,
          e
        );

      } catch (reportError) {

        console.error(
          '[Error Report Failed]',
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
       EXP / LIMIT
    ══════════════════════════════ */

    if (m) {

      try {

        const finalSenderJid =
          m.sender?.endsWith('@lid')
            ? (
                this.getJid
                  ? this.getJid(
                      m.sender
                    )
                  : this.decodeJid(
                      m.sender
                    )
              )
            : this.decodeJid(
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
           * خصم limit فقط للتسجيل.
           *
           * لا يمنع الأمر.
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
          '[Welcome Metadata Error]',
          e
        );

        break;
      }


      for (
        const user of participants
      ) {

        try {

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


          if (
            userJid.endsWith('@lid')
          ) {
            userJid =
              rawId;
          }


          const userNumber =
            userJid.split('@')[0];


          const gpname =
            meta.subject;


          const member =
            meta.participants.length;


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
            '[Welcome Message Error]',
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


      const user =
        participants[0];


      const userJid =
        this.getJid
          ? this.getJid(user)
          : this.decodeJid(user);


      const userNumber =
        userJid.split('@')[0];


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
          '[Promote/Demote Error]',
          e
        );
      }


      break;
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
        quoted: m,
      }
    );

  } catch (e) {

    console.error(
      '[DFAIL ERROR]',
      e
    );
  }
};