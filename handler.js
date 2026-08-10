/*

* handler.js
* AYANA MD
* 
* Compatible with:
* @whiskeysockets/baileys
* @itsliaaa/baileys
* @itsliaaa/starcore
* lib/whatsapp.js
* 
* IMPORTANT:
* - يحافظ على @lid
* - لا يحول @lid بالقوة إلى @s.whatsapp.net
* - يعتمد على lib/whatsapp.js في JID / quoted / presence
* - لا يوجد LIMIT HABIS
* - يدعم incoming:
* buttonsResponseMessage
* listResponseMessage
* templateButtonReplyMessage
* interactiveResponseMessage / native flow
* - لا يفرض raw interactive protocol داخل handler
    */

import {
getAggregateVotesInPollMessage,
proto,
generateWAMessageFromContent,
prepareWAMessageMedia,
jidNormalizedUser,
WAMessageStubType,
} from '@whiskeysockets/baileys'

import {
getRealJid,
sameJid,
normalizeQuoted,
keepOnline,
markRead,
findParticipant,
findBotParticipant,
isAdmin as isParticipantAdmin,
isSuperAdmin,
isBotAdmin as isBotAdminHelper,
} from './lib/whatsapp.js'

import { smsg } from './lib/serialize.js'
import initDatabase from './lib/database.js'
import printMsg from './lib/print.js'

import moment from 'moment-timezone'
import fs from 'fs'
import util from 'util'
import chalk from 'chalk'

/* ══════════════════════════════════════
BASIC HELPERS
══════════════════════════════════════ */

const isNumber = x =>
typeof x === 'number' && !isNaN(x)

const delay = ms =>
isNumber(ms) &&
new Promise(
resolve =>
setTimeout(resolve, ms)
)

/* ══════════════════════════════════════
SAFE ERROR TEXT
══════════════════════════════════════ */

function getErrorText(error) {

if (error == null)
return 'Unknown error'

if (typeof error === 'string')
return error

if (error instanceof Error) {

return (
  error.stack ||
  error.message ||
  String(error)
)

}

try {

return util.format(error)

} catch {

return String(error)

}
}

/* ══════════════════════════════════════
SAFE JSON
══════════════════════════════════════ */

function safeJsonParse(value, fallback = null) {

if (
value == null ||
value === ''
) {
return fallback
}

if (
typeof value === 'object'
) {
return value
}

try {

return JSON.parse(
  String(value)
)

} catch {

return fallback

}
}

/* ══════════════════════════════════════
INTERACTIVE RESPONSE HELPERS
══════════════════════════════════════ */

/*

* WhatsApp interactive replies can arrive
* through different message types depending
* on the client / Baileys version.
* 
* We normalize them here WITHOUT modifying
* the original protobuf message.
  */

function getInteractiveResponse(message) {

if (!message)
return null

/* ────────────────────────────────
BUTTON RESPONSE
──────────────────────────────── */

const button =
message.buttonsResponseMessage

if (button) {

return {

  type: 'button',

  id:
    button.selectedButtonId ||
    button.id ||
    '',

  text:
    button.selectedDisplayText ||
    button.displayText ||
    '',

  title:
    button.selectedDisplayText ||
    button.displayText ||
    '',

  raw: button,

}

}

/* ────────────────────────────────
LIST RESPONSE
──────────────────────────────── */

const list =
message.listResponseMessage

if (list) {

const row =
  list.singleSelectReply


return {

  type: 'list',

  id:
    row?.selectedRowId ||
    '',

  text:
    row?.title ||
    list.title ||
    '',

  title:
    row?.title ||
    list.title ||
    '',

  description:
    row?.description ||
    list.description ||
    '',

  raw: list,

}

}

/* ────────────────────────────────
TEMPLATE BUTTON RESPONSE
──────────────────────────────── */

const template =
message.templateButtonReplyMessage

if (template) {

return {

  type: 'template',

  id:
    template.selectedId ||
    '',

  text:
    template.selectedDisplayText ||
    '',

  title:
    template.selectedDisplayText ||
    '',

  index:
    template.selectedIndex,

  raw: template,

}

}

/* ────────────────────────────────
INTERACTIVE / NATIVE FLOW
──────────────────────────────── */

const interactive =
message.interactiveResponseMessage

if (interactive) {

const native =
  interactive.nativeFlowResponseMessage


if (native) {

  const params =
    safeJsonParse(
      native.paramsJson,
      {}
    ) || {}


  /*
   * Different versions may expose
   * id / description / selectedId
   * differently.
   */

  const id =
    params.id ||
    params.selectedId ||
    params.row_id ||
    params.rowId ||
    ''


  const text =
    params.description ||
    params.display_text ||
    params.displayText ||
    params.title ||
    id ||
    ''


  return {

    type: 'native_flow',

    id,

    text,

    title:
      params.title ||
      text,

    description:
      params.description ||
      '',

    params,

    name:
      native.name ||
      '',

    raw: interactive,

  }
}


/*
 * Some versions may put the
 * response JSON directly in
 * paramsJson.
 */

const params =
  safeJsonParse(
    interactive.paramsJson,
    null
  )


if (params) {

  const id =
    params.id ||
    params.selectedId ||
    params.rowId ||
    ''


  const text =
    params.description ||
    params.displayText ||
    params.display_text ||
    params.title ||
    id ||
    ''


  return {

    type: 'interactive',

    id,

    text,

    title:
      params.title ||
      text,

    description:
      params.description ||
      '',

    params,

    raw: interactive,

  }
}


return {

  type: 'interactive',

  id: '',

  text: '',

  title: '',

  description: '',

  params: {},

  raw: interactive,

}

}

/* ────────────────────────────────
FUTURE / UNKNOWN INTERACTIVE
──────────────────────────────── */

return null
}

/*

* Apply normalized interactive response
* to serialized message.
* 
* We NEVER replace a valid normal message
* with an empty string.
  */

function applyInteractiveResponse(
m,
originalMessage
) {

if (!m)
return m

const response =
getInteractiveResponse(
originalMessage
)

if (!response)
return m

m.interactive =
response

m.interactiveType =
response.type

m.selectedId =
response.id ||
''

m.selectedButtonId =
response.type === 'button'
? response.id
: undefined

m.selectedRowId =
response.type === 'list'
? response.id
: undefined

m.nativeFlowResponse =
response.type === 'native_flow' ||
response.type === 'interactive'
? response
: undefined

/*

* Keep a useful text value.
* 
* This allows a plugin such as:
* 
* command: ['menu']
* 
* to continue working when the user
* selects a button whose id is:
* 
* #menu
  */

if (
response.id ||
response.text
) {

const responseText =
  response.id ||
  response.text


if (
  !m.text ||
  typeof m.text !== 'string'
) {

  m.text =
    responseText

}

}

/*

* Keep explicit response text
* available separately.
  */

m.selectedText =
response.text ||
''

m.selectedDisplayText =
response.title ||
response.text ||
''

return m
}

/* ══════════════════════════════════════
JID HELPERS
══════════════════════════════════════ */

function resolveJid(conn, jid) {

if (!jid)
return jid

return getRealJid(
conn,
jid
)
}

function jidMatches(
conn,
a,
b
) {

if (!a || !b)
return false

if (a === b)
return true

try {

return sameJid(
  conn,
  a,
  b
)

} catch {

return (
  String(a) ===
  String(b)
)

}
}

/* ══════════════════════════════════════
OWNER JID HELPERS
══════════════════════════════════════ */

function getOwnerJids(conn) {

const result = []

/*

* Bot account
  */

const botIds = [

conn?.user?.id,
conn?.user?.lid,
conn?.user?.jid

].filter(Boolean)

for (const jid of botIds) {

result.push(jid)

try {

  const resolved =
    resolveJid(
      conn,
      jid
    )

  if (resolved)
    result.push(resolved)

} catch {}

}

/*

* global.owner
  */

const owners =
Array.isArray(global.owner)
? global.owner
: []

for (const owner of owners) {

const raw =
  Array.isArray(owner)
    ? owner[0]
    : owner


if (!raw)
  continue


const number =
  String(raw)
    .replace(
      /[^0-9]/g,
      ''
    )


if (!number)
  continue


result.push(
  number +
  '@s.whatsapp.net'
)


/*
 * Keep LID candidate too.
 * This is NOT used to forcibly
 * convert a LID.
 */

result.push(
  number +
  '@lid'
)

}

return [
...new Set(
result.filter(Boolean)
)
]
}

function isOwnerJid(
conn,
jid
) {

if (!jid)
return false

const owners =
getOwnerJids(conn)

return owners.some(
owner =>
jidMatches(
conn,
owner,
jid
)
)
}

/* ══════════════════════════════════════
MEDIA / QUOTED
══════════════════════════════════════ */

function normalizeMessageQuoted(m) {

try {

return normalizeQuoted(m)

} catch {

return m

}
}

/* ══════════════════════════════════════
KEEP BOT AVAILABLE
══════════════════════════════════════ */

async function keepBotOnline(
conn,
chat
) {

try {

return await keepOnline(
  conn,
  chat || undefined
)

} catch {

return false

}
}

/* ══════════════════════════════════════
READ MESSAGE
══════════════════════════════════════ */

async function readMessage(
conn,
key
) {

try {

return await markRead(
  conn,
  key
)

} catch {

return false

}
}

/* ══════════════════════════════════════
MAIN HANDLER
══════════════════════════════════════ */

export async function handler(
chatUpdate
) {

if (
global.db.data == null
) {

await global.loadDatabase()

}

this.msgqueque =
this.msgqueque || []

if (!chatUpdate)
return

if (
!chatUpdate.messages?.length
) {
return
}

/* ══════════════════════════════════
PUSH MESSAGE TO STORE
══════════════════════════════════ */

try {

await this.pushMessage(
  chatUpdate.messages
)

} catch (e) {

console.error(
  chalk.yellow(
    '[PushMessage Error]'
  ),
  e
)

}

let rawMessage =
chatUpdate.messages[
chatUpdate.messages.length - 1
]

if (!rawMessage)
return

/* ══════════════════════════════════
IGNORE BOT MESSAGES
══════════════════════════════════ */

if (
rawMessage.key?.fromMe
) {
return
}

if (!rawMessage.message)
return

/*

* Protocol noise.
* 
* Do not ignore interactive responses.
  */

if (
rawMessage.message.protocolMessage
) {
return
}

if (
rawMessage.message.reactionMessage
) {
return
}

try {

/* ════════════════════════════════
   SAVE ORIGINAL MESSAGE
════════════════════════════════ */

const originalMessage =
  rawMessage.message


/* ════════════════════════════════
   SERIALIZE
════════════════════════════════ */

let m =
  smsg(
    this,
    rawMessage
  ) || rawMessage


if (!m)
  return


/* ════════════════════════════════
   INTERACTIVE RESPONSE
════════════════════════════════ */

/*
 * This must happen AFTER smsg()
 * so all normal serialization stays
 * untouched.
 */

applyInteractiveResponse(
  m,
  originalMessage
)


/* ════════════════════════════════
   NORMALIZE QUOTED
════════════════════════════════ */

normalizeMessageQuoted(m)


/* ════════════════════════════════
   KEEP ONLINE
════════════════════════════════ */

await keepBotOnline(
  this,
  m.chat
)


/* ════════════════════════════════
   BASIC VALUES
════════════════════════════════ */

m.exp = 0

/*
 * Limit disabled.
 */

m.limit = false


/* ════════════════════════════════
   DATABASE
════════════════════════════════ */

try {

  initDatabase(m)

} catch (e) {

  console.error(
    chalk.yellow(
      '[Database Error]'
    ),
    e
  )
}


/* ════════════════════════════════
   SENDER
════════════════════════════════ */

const rawSender =
  m.sender ||
  m.key?.participant ||
  m.key?.remoteJid


let senderJid =
  resolveJid(
    this,
    rawSender
  )


senderJid =
  senderJid ||
  rawSender ||
  m.key?.participant ||
  m.key?.remoteJid


if (!senderJid)
  return


/* ════════════════════════════════
   USER OBJECT
════════════════════════════════ */

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

  }
}


/* ════════════════════════════════
   OWNER
════════════════════════════════ */

const ownerJids =
  getOwnerJids(
    this
  )


const isROwner =
  isOwnerJid(
    this,
    senderJid
  ) ||
  isOwnerJid(
    this,
    m.sender
  ) ||
  m.fromMe === true


const isOwner =
  isROwner ||
  m.fromMe === true


const isMods =
  Boolean(
    global.db.data.users[
      senderJid
    ]?.moderator
  )


const isPrems =
  Boolean(
    global.db.data.users[
      senderJid
    ]?.premium
  )


const isBans =
  Boolean(
    global.db.data.users[
      senderJid
    ]?.banned
  )


const isWhitelist =
  Boolean(
    global.db.data.chats[
      m.chat
    ]?.whitelist
  )


/* ════════════════════════════════
   AUTO OWNER PERMISSION
════════════════════════════════ */

if (isROwner) {

  global.db.data.users[
    senderJid
  ].premium = true


  global.db.data.users[
    senderJid
  ].premiumDate =
    'PERMANENT'


  global.db.data.users[
    senderJid
  ].limit =
    'PERMANENT'


  global.db.data.users[
    senderJid
  ].moderator = true
}


/* ════════════════════════════════
   BAN
════════════════════════════════ */

if (
  isBans &&
  !isROwner
) {
  return
}


/* ════════════════════════════════
   GROUP METADATA
════════════════════════════════ */

if (m.isGroup) {

  try {

    const meta =
      await this.groupMetadata(
        m.chat
      )


    if (
      !global.db.data.chats[
        m.chat
      ]
    ) {

      global.db.data.chats[
        m.chat
      ] = {}

    }


    const members =
      Array.isArray(
        meta?.participants
      )
        ? meta.participants.map(
            a =>
              a?.id ||
              a?.phoneNumber
          ).filter(Boolean)
        : []


    global.db.data.chats[
      m.chat
    ].member =
      members


    global.db.data.chats[
      m.chat
    ].chat =
      (
        global.db.data.chats[
          m.chat
        ].chat || 0
      ) + 1

  } catch {}
}


/* ════════════════════════════════
   GLOBAL GUARDS
════════════════════════════════ */

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


/* ════════════════════════════════
   QUEUE
════════════════════════════════ */

if (
  global.opts?.queque &&
  m.text &&
  !(isMods || isPrems)
) {

  const queue =
    this.msgqueque


  const prev =
    queue[
      queue.length - 1
    ]


  const messageId =
    m.id ||
    m.key?.id


  queue.push(
    messageId
  )


  const t =
    setInterval(
      async () => {

        if (
          !queue.includes(prev)
        ) {

          clearInterval(t)

        } else {

          await delay(5000)

        }

      },
      5000
    )
}


/* ════════════════════════════════
   USER STATS
════════════════════════════════ */

const userData =
  global.db.data.users[
    senderJid
  ]


userData.online =
  Date.now()


userData.chat =
  (
    userData.chat || 0
  ) + 1


/* ════════════════════════════════
   READ MESSAGE
════════════════════════════════ */

try {

  if (
    typeof this.readMessages ===
      'function' &&
    m.key
  ) {

    await readMessage(
      this,
      m.key
    )
  }

} catch (e) {

  console.error(
    chalk.yellow(
      '[Read Error]'
    ),
    e
  )
}


/* ════════════════════════════════
   NYIMAK
════════════════════════════════ */

if (
  global.opts?.nyimak
) {
  return
}


/* ════════════════════════════════
   TEXT
════════════════════════════════ */

if (
  typeof m.text !== 'string'
) {

  m.text = ''

}


if (m.isBaileys)
  return


/* ════════════════════════════════
   EXP
════════════════════════════════ */

m.exp +=
  Math.ceil(
    Math.random() * 1000
  )


/* ════════════════════════════════
   PLUGIN PREPARATION
════════════════════════════════ */

let usedPrefix


const _user =
  global.db.data.users[
    senderJid
  ]


let groupMetadata = {}


if (m.isGroup) {

  groupMetadata =
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
}


const participants =
  m.isGroup
    ? (
        groupMetadata.participants ||
        []
      )
    : []


/* ════════════════════════════════
   USER JID
════════════════════════════════ */

const userJid =
  resolveJid(
    this,
    m.sender
  )


/* ════════════════════════════════
   FIND USER
════════════════════════════════ */

const user =
  m.isGroup
    ? (
        findParticipant(
          this,
          participants,
          userJid
        ) || {}
      )
    : {}


/* ════════════════════════════════
   FIND BOT
════════════════════════════════ */

const bot =
  m.isGroup
    ? (
        findBotParticipant(
          this,
          participants
        ) || {}
      )
    : {}


/* ════════════════════════════════
   ADMIN
════════════════════════════════ */

const isRAdmin =
  isSuperAdmin(
    user
  )


const isAdmin =
  isParticipantAdmin(
    user
  )


const isBotAdmin =
  isBotAdminHelper(
    this,
    participants
  )


/* ════════════════════════════════
   STORE METADATA
════════════════════════════════ */

if (
  m.isGroup &&
  groupMetadata.id
) {

  if (!global.store)
    global.store = {}


  if (
    !global.store.groupMetadata
  ) {

    global.store.groupMetadata = {}

  }


  global.store.groupMetadata[
    m.chat
  ] =
    groupMetadata
}


/* ════════════════════════════════
   PLUGIN LOOP
════════════════════════════════ */

for (
  const name in global.plugins
) {

  const plugin =
    global.plugins[name]


  if (!plugin)
    continue


  if (plugin.disabled)
    continue


  /* ══════════════════════════════
     ALL
  ══════════════════════════════ */

  if (
    typeof plugin.all ===
    'function'
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


  /* ══════════════════════════════
     PREFIX
  ══════════════════════════════ */

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
      _prefix.exec(
        m.text
      )


    match =
      result
        ? [
            result,
            _prefix
          ]
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
            re.exec(
              m.text
            ),
            re
          ]

        })
        .find(
          p => p[0]
        )

  } else if (
    typeof _prefix === 'string'
  ) {

    const re =
      new RegExp(
        str2Regex(
          _prefix
        )
      )


    match = [
      re.exec(
        m.text
      ),
      re
    ]


    if (!match[0])
      match = null

  } else {

    match = null

  }


  /* ══════════════════════════════
     BEFORE
  ══════════════════════════════ */

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

            /*
             * Interactive response
             * is also available here.
             */

            interactive:
              m.interactive,

            selectedId:
              m.selectedId,

            selectedButtonId:
              m.selectedButtonId,

            selectedRowId:
              m.selectedRowId,

            nativeFlowResponse:
              m.nativeFlowResponse,

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


      try {

        await m.reply(
          `❌ *خطأ داخل before للـ Plugin*\n\n` +
          `*Plugin:* ${name}\n\n` +
          `\`\`\`\n` +
          `${getErrorText(e).slice(
            0,
            3500
          )}` +
          `\n\`\`\``
        )

      } catch {}
    }
  }


  /* ══════════════════════════════
     PLUGIN FUNCTION
  ══════════════════════════════ */

  if (
    typeof plugin !==
    'function'
  ) {
    continue
  }


  if (!match)
    continue


  /* ══════════════════════════════
     COMMAND
  ══════════════════════════════ */

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
        : m.text
            .replace(
              result,
              ''
            )
            .trim()

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
    (
      command || ''
    ).toLowerCase()


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
    Array.isArray(
      prefixCommand
    )
  ) {

    isAccept =
      prefixCommand.some(
        c => {

          if (
            c instanceof RegExp
          ) {

            c.lastIndex = 0

            return c.test(
              command
            )

          }

          return c === command

        }
      )

  } else if (
    typeof prefixCommand ===
    'string'
  ) {

    isAccept =
      prefixCommand ===
      command

  }


  m.prefix =
    !!result


  usedPrefix =
    !result
      ? ''
      : result


  if (!isAccept)
    continue


  /* ══════════════════════════════
     COMMAND INFO
  ══════════════════════════════ */

  m.plugin =
    name


  m.chatUpdate =
    chatUpdate


  m.command =
    command


  m.isCommand =
    true


  /* ══════════════════════════════
     CHAT GUARDS
  ══════════════════════════════ */

  const chatData =
    global.db.data.chats[
      m.chat
    ]


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


  /* ══════════════════════════════
     BLOCK COMMAND
  ══════════════════════════════ */

  if (
    global.db.data
      .settings
      ?.blockcmd
      ?.includes(
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


  /* ══════════════════════════════
     PERMISSIONS
  ══════════════════════════════ */

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


  /* ══════════════════════════════
     LIMIT DISABLED
  ══════════════════════════════ */

  m.limit =
    false


  /* ══════════════════════════════
     LEVEL
  ══════════════════════════════ */

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


  /* ══════════════════════════════
     RESPONSE STATS
  ══════════════════════════════ */

  if (
    !global.db.data.respon
  ) {

    global.db.data.respon =
      {}

  }


  const now =
    Date.now()


  const stat =
    global.db.data.respon[
      m.command
    ]


  if (stat) {

    stat.total =
      (
        stat.total || 0
      ) + 1


    stat.last =
      now

  } else {

    global.db.data.respon[
      m.command
    ] = {

      total: 1,
      success: 0,
      last: now,
      lastSuccess: 0,

    }
  }


  /* ══════════════════════════════
     EXP
  ══════════════════════════════ */

  const xp =
    'exp' in plugin
      ? parseInt(
          plugin.exp
        )
      : 17


  m.exp +=
    isNaN(xp)
      ? 17
      : xp


  /* ══════════════════════════════
     EXTRA
  ══════════════════════════════ */

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

    /*
     * Interactive helpers
     */

    interactive:
      m.interactive,

    selectedId:
      m.selectedId,

    selectedButtonId:
      m.selectedButtonId,

    selectedRowId:
      m.selectedRowId,

    selectedText:
      m.selectedText,

    nativeFlowResponse:
      m.nativeFlowResponse,

  }


  /* ══════════════════════════════
     EXECUTE PLUGIN
  ══════════════════════════════ */

  try {

    normalizeMessageQuoted(m)


    await plugin.call(
      this,
      m,
      extra
    )


    m.limit =
      false


    const s =
      global.db.data.respon[
        m.command
      ]


    if (s) {

      s.success =
        (
          s.success || 0
        ) + 1


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

        plugin:
          m.plugin,

        command:
          m.command,

        chat:
          m.chat,

        sender:
          m.sender,

        error:
          errText,

      }
    )


    /* ════════════════════════════
       SEND ERROR TO USER
    ════════════════════════════ */

    try {

      await m.reply(
        `${errText.slice(
          0,
          3500
        )}`
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
       REPORT OWNER
    ════════════════════════════ */

    try {

      const owners =
        Array.isArray(
          global.owner
        )
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


          if (!cleanNumber)
            continue


          const ownerJid =
            cleanNumber +
            '@s.whatsapp.net'


          await this.sendMessage(
            ownerJid,
            {
              text:
                errText.slice(
                  0,
                  3500
                )
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


  } finally {

    /* ════════════════════════════
       AFTER
    ════════════════════════════ */

    if (
      typeof plugin.after ===
      'function'
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


/* ══════════════════════════════
   HANDLER ERROR
══════════════════════════════ */

try {

  if (m?.chat) {

    await m.reply(
      `*[ HANDLER ERROR ]*\n\n` +
      `\`\`\`\n` +
      `${errorText.slice(
        0,
        3500
      )}` +
      `\n\`\`\``
    )
  }

} catch {}

}

/* ══════════════════════════════════════
FINALLY
══════════════════════════════════════ */

finally {

/* ════════════════════════════════
   QUEUE CLEANUP
════════════════════════════════ */

try {

  if (
    global.opts?.queque &&
    m?.text
  ) {

    const messageId =
      m.id ||
      m.key?.id


    const idx =
      this.msgqueque.indexOf(
        messageId
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
      resolveJid(
        this,
        m.sender
      )


    const u =
      global.db.data.users[
        finalSenderJid
      ]


    if (u) {

      u.exp =
        (
          u.exp || 0
        ) +
        (
          m.exp || 0
        )

      /*
       * لا يتم إنقاص Limit.
       */
    }
  }

} catch (e) {

  console.error(
    '[Handler] User update error:',
    e
  )
}


/* ════════════════════════════════
   PRINT
════════════════════════════════ */

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
      await this.groupMetadata(
        id
      )

  } catch {

    return

  }


  for (
    const participant of
    participants
  ) {

    /*
     * Baileys الجديد قد يعطينا:
     *
     * {
     *   id: "...@lid",
     *   phoneNumber: "...@s.whatsapp.net",
     *   admin: null
     * }
     */

    const rawId =
      participant?.id ||
      participant?.phoneNumber ||
      participant


    let userJid =
      resolveJid(
        this,
        rawId
      )


    if (
      !userJid &&
      participant?.phoneNumber
    ) {

      userJid =
        participant.phoneNumber
    }


    if (!userJid)
      continue


    const userNumber =
      String(userJid)
        .split('@')[0]


    const gpname =
      meta.subject ||
      'Group'


    const member =
      Array.isArray(
        meta.participants
      )
        ? meta.participants.length
        : 0


    const time =
      moment
        .tz('Asia/Jakarta')
        .format(
          'HH:mm:ss'
        )


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


  const participant =
    participants?.[0]


  if (!participant)
    break


  const rawId =
    participant?.id ||
    participant?.phoneNumber ||
    participant


  const userJid =
    resolveJid(
      this,
      rawId
    )


  if (!userJid)
    break


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
  `│ Fitur ini hanya pour Admin group!\n` +
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

if (!msgs[type])
return

try {

await conn.sendMessage(
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