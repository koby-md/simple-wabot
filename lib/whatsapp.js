/*
 * lib/whatsapp.js
 * AYANA MD - WhatsApp Helper Layer
 *
 * Compatible with:
 * @whiskeysockets/baileys -> npm:@itsliaaa/starcore
 *
 * الهدف:
 * وضع وظائف WhatsApp في ملف واحد حتى يبقى handler.js بسيطاً.
 */

import {
  jidNormalizedUser,
  prepareWAMessageMedia
} from '@whiskeysockets/baileys'


/* ══════════════════════════════════════
   BASIC HELPERS
══════════════════════════════════════ */

export function isValidJid(jid) {
  return (
    typeof jid === 'string' &&
    jid.length > 3 &&
    jid.includes('@')
  )
}


export function getRealJid(conn, jid) {

  if (!jid) {
    return jid
  }

  try {

    if (
      conn &&
      typeof conn.getJid === 'function'
    ) {

      const result =
        conn.getJid(jid)

      if (
        typeof result === 'string' &&
        result
      ) {
        return result
      }
    }

  } catch {}


  try {

    if (
      conn &&
      typeof conn.decodeJid === 'function'
    ) {

      const result =
        conn.decodeJid(jid)

      if (result) {
        return result
      }
    }

  } catch {}


  try {
    return jidNormalizedUser(jid)
  } catch {
    return jid
  }
}


/* ══════════════════════════════════════
   SAFE SEND
══════════════════════════════════════ */

export async function send(
  conn,
  jid,
  content,
  options = {}
) {

  if (!conn) {
    throw new Error(
      'WhatsApp connection is not available'
    )
  }

  if (!jid) {
    throw new Error(
      'WhatsApp JID is missing'
    )
  }

  if (
    !content ||
    typeof content !== 'object'
  ) {
    throw new Error(
      'WhatsApp message content is invalid'
    )
  }

  return conn.sendMessage(
    jid,
    content,
    options
  )
}


/* ══════════════════════════════════════
   TEXT
══════════════════════════════════════ */

export async function sendText(
  conn,
  jid,
  text,
  quoted = null,
  extra = {}
) {

  const content = {
    text: String(text ?? ''),
    ...extra
  }

  const options = {}

  if (quoted) {
    options.quoted = quoted
  }

  return send(
    conn,
    jid,
    content,
    options
  )
}


/* ══════════════════════════════════════
   REACTION
══════════════════════════════════════ */

export async function sendReaction(
  conn,
  jid,
  key,
  emoji
) {

  return send(
    conn,
    jid,
    {
      react: {
        text: String(emoji ?? ''),
        key
      }
    }
  )
}


/* ══════════════════════════════════════
   POLL
══════════════════════════════════════ */

export async function sendPoll(
  conn,
  jid,
  name,
  values = [],
  options = {}
) {

  if (!Array.isArray(values)) {
    values = []
  }

  const poll = {
    name: String(name ?? ''),
    values: values.map(
      value => String(value)
    ),
    selectableCount:
      Number.isInteger(
        options.selectableCount
      )
        ? options.selectableCount
        : 1
  }


  if (
    options.toAnnouncementGroup !== undefined
  ) {
    poll.toAnnouncementGroup =
      Boolean(
        options.toAnnouncementGroup
      )
  }


  if (
    options.endDate instanceof Date
  ) {
    poll.endDate =
      options.endDate
  }


  if (
    options.hideVoter !== undefined
  ) {
    poll.hideVoter =
      Boolean(options.hideVoter)
  }


  if (
    options.canAddOption !== undefined
  ) {
    poll.canAddOption =
      Boolean(options.canAddOption)
  }


  if (options.correctAnswer) {
    poll.correctAnswer =
      String(options.correctAnswer)

    poll.pollType =
      options.pollType ?? 1
  }


  const sendOptions = {}

  if (options.quoted) {
    sendOptions.quoted =
      options.quoted
  }


  return send(
    conn,
    jid,
    {
      poll
    },
    sendOptions
  )
}


/* ══════════════════════════════════════
   POLL RESULT
══════════════════════════════════════ */

export async function sendPollResult(
  conn,
  jid,
  name,
  votes = [],
  options = {}
) {

  const content = {

    pollResult: {

      name:
        String(name ?? ''),

      votes:
        Array.isArray(votes)
          ? votes.map(v => ({
              name:
                String(v?.name ?? ''),
              voteCount:
                Number(v?.voteCount ?? 0)
            }))
          : [],

      pollType:
        options.pollType ?? 0
    }
  }


  const sendOptions = {}

  if (options.quoted) {
    sendOptions.quoted =
      options.quoted
  }


  return send(
    conn,
    jid,
    content,
    sendOptions
  )
}


/* ══════════════════════════════════════
   SIMPLE BUTTONS
══════════════════════════════════════ */

export async function sendButtons(
  conn,
  jid,
  text,
  buttons = [],
  options = {}
) {

  const content = {

    text:
      String(text ?? ''),

    buttons:
      Array.isArray(buttons)
        ? buttons.map(button => ({
            text:
              String(
                button?.text ?? ''
              ),

            id:
              String(
                button?.id ?? ''
              )
          }))
        : [],

    footer:
      options.footer
        ? String(options.footer)
        : undefined
  }


  if (options.header) {
    content.header =
      String(options.header)
  }


  const sendOptions = {}

  if (options.quoted) {
    sendOptions.quoted =
      options.quoted
  }


  return send(
    conn,
    jid,
    content,
    sendOptions
  )
}


/* ══════════════════════════════════════
   BUTTONS + MEDIA
══════════════════════════════════════ */

export async function sendMediaButtons(
  conn,
  jid,
  media,
  caption,
  buttons = [],
  options = {}
) {

  const content = {

    caption:
      String(caption ?? ''),

    buttons:
      Array.isArray(buttons)
        ? buttons
        : []
  }


  if (options.footer) {
    content.footer =
      String(options.footer)
  }


  /*
   * media:
   *
   * {
   *   image: { url: '...' }
   * }
   *
   * أو
   *
   * {
   *   video: { url: '...' }
   * }
   */

  if (
    media &&
    typeof media === 'object'
  ) {

    if (media.image) {
      content.image =
        media.image
    }

    if (media.video) {
      content.video =
        media.video
    }

    if (media.document) {
      content.document =
        media.document
    }
  }


  const sendOptions = {}

  if (options.quoted) {
    sendOptions.quoted =
      options.quoted
  }


  return send(
    conn,
    jid,
    content,
    sendOptions
  )
}


/* ══════════════════════════════════════
   LIST MESSAGE
══════════════════════════════════════ */

export async function sendList(
  conn,
  jid,
  text,
  sections = [],
  options = {}
) {

  const content = {

    text:
      String(text ?? ''),

    buttonText:
      String(
        options.buttonText ??
        'Select'
      ),

    sections:
      Array.isArray(sections)
        ? sections
        : []
  }


  if (options.title) {
    content.title =
      String(options.title)
  }


  if (options.footer) {
    content.footer =
      String(options.footer)
  }


  const sendOptions = {}

  if (options.quoted) {
    sendOptions.quoted =
      options.quoted
  }


  return send(
    conn,
    jid,
    content,
    sendOptions
  )
}


/* ══════════════════════════════════════
   NATIVE FLOW
══════════════════════════════════════ */

export async function sendNativeFlow(
  conn,
  jid,
  text,
  nativeFlow = [],
  options = {}
) {

  const content = {

    text:
      String(text ?? ''),

    nativeFlow:
      Array.isArray(nativeFlow)
        ? nativeFlow
        : []
  }


  if (options.footer) {
    content.footer =
      String(options.footer)
  }


  if (options.optionText) {
    content.optionText =
      String(options.optionText)
  }


  if (options.optionTitle) {
    content.optionTitle =
      String(options.optionTitle)
  }


  if (options.offerText) {
    content.offerText =
      String(options.offerText)
  }


  if (options.offerCode) {
    content.offerCode =
      String(options.offerCode)
  }


  if (options.offerUrl) {
    content.offerUrl =
      String(options.offerUrl)
  }


  if (options.offerExpiration) {
    content.offerExpiration =
      Number(options.offerExpiration)
  }


  if (
    options.interactiveAsTemplate !== undefined
  ) {

    content.interactiveAsTemplate =
      Boolean(
        options.interactiveAsTemplate
      )
  }


  const sendOptions = {}

  if (options.quoted) {
    sendOptions.quoted =
      options.quoted
  }


  return send(
    conn,
    jid,
    content,
    sendOptions
  )
}


/* ══════════════════════════════════════
   NATIVE FLOW + IMAGE
══════════════════════════════════════ */

export async function sendNativeFlowImage(
  conn,
  jid,
  image,
  caption,
  nativeFlow = [],
  options = {}
) {

  const content = {

    image,

    caption:
      String(caption ?? ''),

    nativeFlow:
      Array.isArray(nativeFlow)
        ? nativeFlow
        : []
  }


  if (options.footer) {
    content.footer =
      String(options.footer)
  }


  if (options.optionText) {
    content.optionText =
      String(options.optionText)
  }


  if (options.optionTitle) {
    content.optionTitle =
      String(options.optionTitle)
  }


  if (options.offerText) {
    content.offerText =
      String(options.offerText)
  }


  if (options.offerCode) {
    content.offerCode =
      String(options.offerCode)
  }


  if (options.offerUrl) {
    content.offerUrl =
      String(options.offerUrl)
  }


  if (options.offerExpiration) {
    content.offerExpiration =
      Number(options.offerExpiration)
  }


  const sendOptions = {}

  if (options.quoted) {
    sendOptions.quoted =
      options.quoted
  }


  return send(
    conn,
    jid,
    content,
    sendOptions
  )
}


/* ══════════════════════════════════════
   MEDIA
══════════════════════════════════════ */

export async function sendImage(
  conn,
  jid,
  image,
  caption = '',
  quoted = null,
  options = {}
) {

  const content = {

    image,

    caption:
      String(caption ?? ''),

    ...options
  }


  const sendOptions = {}

  if (quoted) {
    sendOptions.quoted =
      quoted
  }


  return send(
    conn,
    jid,
    content,
    sendOptions
  )
}


export async function sendVideo(
  conn,
  jid,
  video,
  caption = '',
  quoted = null,
  options = {}
) {

  const content = {

    video,

    caption:
      String(caption ?? ''),

    ...options
  }


  const sendOptions = {}

  if (quoted) {
    sendOptions.quoted =
      quoted
  }


  return send(
    conn,
    jid,
    content,
    sendOptions
  )
}


export async function sendAudio(
  conn,
  jid,
  audio,
  quoted = null,
  options = {}
) {

  const content = {

    audio,

    mimetype:
      options.mimetype ||
      'audio/mpeg',

    ptt:
      Boolean(options.ptt)

  }


  const sendOptions = {}

  if (quoted) {
    sendOptions.quoted =
      quoted
  }


  return send(
    conn,
    jid,
    content,
    sendOptions
  )
}


export async function sendDocument(
  conn,
  jid,
  document,
  fileName = 'file',
  mimetype = 'application/octet-stream',
  quoted = null,
  options = {}
) {

  const content = {

    document,

    fileName,

    mimetype,

    ...options
  }


  const sendOptions = {}

  if (quoted) {
    sendOptions.quoted =
      quoted
  }


  return send(
    conn,
    jid,
    content,
    sendOptions
  )
}


/* ══════════════════════════════════════
   STICKER
══════════════════════════════════════ */

export async function sendSticker(
  conn,
  jid,
  sticker,
  quoted = null
) {

  const sendOptions = {}

  if (quoted) {
    sendOptions.quoted =
      quoted
  }


  return send(
    conn,
    jid,
    {
      sticker
    },
    sendOptions
  )
}


/* ══════════════════════════════════════
   LOCATION
══════════════════════════════════════ */

export async function sendLocation(
  conn,
  jid,
  latitude,
  longitude,
  name = '',
  address = '',
  quoted = null
) {

  const sendOptions = {}

  if (quoted) {
    sendOptions.quoted =
      quoted
  }


  return send(
    conn,
    jid,
    {
      location: {

        degreesLatitude:
          Number(latitude),

        degreesLongitude:
          Number(longitude),

        name:
          String(name ?? ''),

        address:
          String(address ?? '')
      }
    },
    sendOptions
  )
}


/* ══════════════════════════════════════
   CONTACT
══════════════════════════════════════ */

export async function sendContact(
  conn,
  jid,
  displayName,
  phone,
  quoted = null
) {

  const number =
    String(phone)
      .replace(
        /[^0-9+]/g,
        ''
      )


  const vcard =
    [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${displayName}`,
      `TEL;type=CELL;type=VOICE;waid=${number.replace(/\D/g, '')}:${number}`,
      'END:VCARD'
    ].join('\n')


  const sendOptions = {}

  if (quoted) {
    sendOptions.quoted =
      quoted
  }


  return send(
    conn,
    jid,
    {
      contacts: {

        displayName:
          String(displayName),

        contacts: [
          {
            vcard
          }
        ]
      }
    },
    sendOptions
  )
}


/* ══════════════════════════════════════
   QUOTED NORMALIZER
══════════════════════════════════════ */

export function normalizeQuoted(m) {

  try {

    if (!m) {
      return m
    }


    const q =
      m.quoted


    if (!q) {
      return m
    }


    let mime =

      q.mimetype ||

      q.msg?.mimetype ||

      q.message?.imageMessage?.mimetype ||

      q.message?.videoMessage?.mimetype ||

      q.message?.audioMessage?.mimetype ||

      q.message?.documentMessage?.mimetype ||

      q.message?.stickerMessage?.mimetype ||

      q.message
        ?.documentWithCaptionMessage
        ?.message
        ?.documentMessage
        ?.mimetype ||

      ''


    if (mime) {

      q.mimetype =
        mime


      if (
        q.msg &&
        !q.msg.mimetype
      ) {

        q.msg.mimetype =
          mime
      }
    }


    if (!q.mtype) {

      if (q.message?.audioMessage) {
        q.mtype =
          'audioMessage'

      } else if (
        q.message?.videoMessage
      ) {
        q.mtype =
          'videoMessage'

      } else if (
        q.message?.imageMessage
      ) {
        q.mtype =
          'imageMessage'

      } else if (
        q.message?.documentMessage
      ) {
        q.mtype =
          'documentMessage'

      } else if (
        q.message?.stickerMessage
      ) {
        q.mtype =
          'stickerMessage'
      }
    }


    if (
      !q.msg &&
      q.message
    ) {

      q.msg =

        q.message.audioMessage ||

        q.message.videoMessage ||

        q.message.imageMessage ||

        q.message.documentMessage ||

        q.message.stickerMessage ||

        q.message
          .documentWithCaptionMessage
          ?.message
          ?.documentMessage ||

        null
    }


    if (
      typeof q.download !== 'function' &&
      typeof m.downloadQuoted === 'function'
    ) {

      q.download =
        (...args) =>
          m.downloadQuoted(...args)
    }


    return m

  } catch {

    return m
  }
}


/* ══════════════════════════════════════
   PRESENCE
══════════════════════════════════════ */

export async function keepOnline(
  conn,
  jid = undefined
) {

  try {

    if (
      typeof conn?.sendPresenceUpdate ===
      'function'
    ) {

      await conn.sendPresenceUpdate(
        'available',
        jid
      )
    }

  } catch {}
}


/* ══════════════════════════════════════
   READ MESSAGE
══════════════════════════════════════ */

export async function markRead(
  conn,
  key
) {

  try {

    if (
      !conn ||
      typeof conn.readMessages !==
      'function'
    ) {
      return false
    }


    if (!key) {
      return false
    }


    await conn.readMessages([
      key
    ])

    return true

  } catch {

    return false
  }
}


/* ══════════════════════════════════════
   GROUP METADATA
══════════════════════════════════════ */

export async function getGroupMetadata(
  conn,
  jid
) {

  if (
    !conn ||
    typeof conn.groupMetadata !==
    'function'
  ) {
    return null
  }


  try {

    return await conn.groupMetadata(
      jid
    )

  } catch {

    return null
  }
}


/* ══════════════════════════════════════
   PARTICIPANT FINDER
══════════════════════════════════════ */

export function findParticipant(
  conn,
  participants = [],
  jid
) {

  if (!Array.isArray(participants)) {
    return null
  }


  const target =
    getRealJid(
      conn,
      jid
    )


  return (
    participants.find(
      participant => {

        if (!participant) {
          return false
        }


        const id =
          getRealJid(
            conn,
            participant.id
          )


        const phone =
          getRealJid(
            conn,
            participant.phoneNumber
          )


        return (
          id === target ||
          phone === target ||
          participant.id === jid ||
          participant.phoneNumber === jid
        )
      }
    ) ||
    null
  )
}


/* ══════════════════════════════════════
   BOT PARTICIPANT
══════════════════════════════════════ */

export function findBotParticipant(
  conn,
  participants = []
) {

  const botJid =
    getRealJid(
      conn,
      conn?.user?.id
    )


  return findParticipant(
    conn,
    participants,
    botJid
  )
}


/* ══════════════════════════════════════
   ADMIN HELPERS
══════════════════════════════════════ */

export function isAdmin(
  participant
) {

  return (
    participant?.admin === 'admin' ||
    participant?.admin === 'superadmin'
  )
}


export function isSuperAdmin(
  participant
) {

  return (
    participant?.admin ===
    'superadmin'
  )
}


export function isBotAdmin(
  conn,
  participants = []
) {

  const bot =
    findBotParticipant(
      conn,
      participants
    )


  return Boolean(
    bot &&
    isAdmin(bot)
  )
}


/* ══════════════════════════════════════
   EXPORT DEFAULT
══════════════════════════════════════ */

export default {

  isValidJid,

  getRealJid,

  send,

  sendText,

  sendReaction,

  sendPoll,

  sendPollResult,

  sendButtons,

  sendMediaButtons,

  sendList,

  sendNativeFlow,

  sendNativeFlowImage,

  sendImage,

  sendVideo,

  sendAudio,

  sendDocument,

  sendSticker,

  sendLocation,

  sendContact,

  normalizeQuoted,

  keepOnline,

  markRead,

  getGroupMetadata,

  findParticipant,

  findBotParticipant,

  isAdmin,

  isSuperAdmin,

  isBotAdmin
}