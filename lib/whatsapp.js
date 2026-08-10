/*
 * lib/whatsapp.js
 * AYANA MD
 *
 * WhatsApp utility + Starcore helpers
 *
 * IMPORTANT:
 * - يحافظ على @lid
 * - لا يحول @lid بالقوة إلى @s.whatsapp.net
 * - يعمل مع Baileys / @itsliaaa/baileys / @itsliaaa/starcore
 * - يحتوي على:
 *   JID helpers
 *   LID helpers
 *   quoted helpers
 *   presence
 *   read messages
 *   participant/admin helpers
 *   buttons
 *   lists
 *   native flow
 *   carousel
 *   media
 *   polls
 *   contacts
 *   location
 *   event
 *   group invite
 *   product
 *   rich response
 *   code
 *   table
 *   inline entities
 *   album
 *   sticker pack
 *   reactions
 *   pin
 *   keep
 *   forward
 *   delete
 *   edit
 *   view once
 *   spoiler
 *   ephemeral
 *   mention all
 *   external ad reply
 */


/* ══════════════════════════════════════
   BASIC HELPERS
══════════════════════════════════════ */

export const isJid = jid =>
  typeof jid === 'string' &&
  jid.includes('@')


export const jidType = jid => {

  if (!jid || typeof jid !== 'string')
    return null

  return jid.split('@')[1] || null
}


export const isLid = jid =>
  typeof jid === 'string' &&
  jid.endsWith('@lid')


export const isPn = jid =>
  typeof jid === 'string' &&
  jid.endsWith('@s.whatsapp.net')


export const isGroupJid = jid =>
  typeof jid === 'string' &&
  jid.endsWith('@g.us')


export const isNewsletterJid = jid =>
  typeof jid === 'string' &&
  jid.endsWith('@newsletter')


export const isBroadcastJid = jid =>
  typeof jid === 'string' &&
  jid.endsWith('@broadcast')


export const isStatusJid = jid =>
  jid === 'status@broadcast'


/* ══════════════════════════════════════
   CLEAN NUMBER
══════════════════════════════════════ */

export function cleanNumber(value) {

  if (value == null)
    return ''


  return String(value)
    .replace(/[^0-9]/g, '')
}


/* ══════════════════════════════════════
   SAFE JID
══════════════════════════════════════ */

export function jidFromNumber(number) {

  const clean =
    cleanNumber(number)


  if (!clean)
    return null


  return (
    clean +
    '@s.whatsapp.net'
  )
}


/*
 * IMPORTANT:
 *
 * This function does NOT convert @lid.
 *
 * If the input is already a JID,
 * it is returned untouched.
 */

export function normalizeJid(jid) {

  if (!jid)
    return jid


  if (typeof jid !== 'string')
    return jid


  if (jid.includes('@'))
    return jid


  const number =
    cleanNumber(jid)


  if (!number)
    return jid


  return (
    number +
    '@s.whatsapp.net'
  )
}


/* ══════════════════════════════════════
   REAL JID / LID RESOLUTION
══════════════════════════════════════ */

/*
 * Tries to resolve an ID using Baileys'
 * own mapping if available.
 *
 * IMPORTANT:
 * We never do:
 *
 * lid -> number@s.whatsapp.net
 *
 * by ourselves.
 */

export function getRealJid(
  conn,
  jid
) {

  if (!jid)
    return jid


  if (
    typeof jid !== 'string'
  ) {
    return jid
  }


  /*
   * Already a valid JID.
   */

  if (
    jid.endsWith('@g.us') ||
    jid.endsWith('@newsletter') ||
    jid.endsWith('@broadcast') ||
    jid.endsWith('@status') ||
    jid.endsWith('@lid') ||
    jid.endsWith('@s.whatsapp.net') ||
    jid.endsWith('@bot')
  ) {

    /*
     * Try explicit PN/LID mapping
     * only when available.
     */

    try {

      if (
        typeof conn?.signalRepository
          ?.lidMapping?.getPNForLID ===
        'function' &&
        jid.endsWith('@lid')
      ) {

        /*
         * Do not replace the LID.
         *
         * The LID itself is the safest
         * identity for message handling.
         */

        return jid
      }

    } catch {}


    return jid
  }


  /*
   * Plain number.
   */

  const number =
    cleanNumber(jid)


  if (!number)
    return jid


  return (
    number +
    '@s.whatsapp.net'
  )
}


/* ══════════════════════════════════════
   JID COMPARISON
══════════════════════════════════════ */

export function sameJid(
  conn,
  a,
  b
) {

  if (!a || !b)
    return false


  if (a === b)
    return true


  const A =
    String(a)


  const B =
    String(b)


  /*
   * Exact LID comparison.
   *
   * Never compare the numeric part
   * of a LID with a phone number.
   */

  if (
    isLid(A) ||
    isLid(B)
  ) {

    return A === B

  }


  /*
   * Groups / newsletters / broadcasts
   * must also be exact.
   */

  if (
    isGroupJid(A) ||
    isGroupJid(B) ||
    isNewsletterJid(A) ||
    isNewsletterJid(B) ||
    isBroadcastJid(A) ||
    isBroadcastJid(B)
  ) {

    return A === B

  }


  /*
   * Normal PN comparison.
   */

  if (
    isPn(A) &&
    isPn(B)
  ) {

    return (
      A.split('@')[0] ===
      B.split('@')[0]
    )
  }


  return (
    normalizeJid(A) ===
    normalizeJid(B)
  )
}


/* ══════════════════════════════════════
   QUOTED HELPERS
══════════════════════════════════════ */

export function normalizeQuoted(m) {

  if (!m)
    return m


  /*
   * Most serializers already expose
   * m.quoted.
   */

  if (m.quoted)
    return m


  const message =
    m.message ||
    m.msg ||
    null


  if (!message)
    return m


  /*
   * Try common wrapper locations.
   */

  const context =
    message?.extendedTextMessage
      ?.contextInfo ||
    message?.imageMessage
      ?.contextInfo ||
    message?.videoMessage
      ?.contextInfo ||
    message?.buttonsMessage
      ?.contextInfo ||
    message?.listMessage
      ?.contextInfo ||
    message?.templateMessage
      ?.contextInfo ||
    message?.interactiveMessage
      ?.contextInfo ||
    null


  if (!context)
    return m


  if (
    !context.quotedMessage
  ) {
    return m
  }


  /*
   * We intentionally don't fabricate
   * a complete Baileys quoted object.
   *
   * The serializer should handle that.
   */

  return m
}


/* ══════════════════════════════════════
   PRESENCE
══════════════════════════════════════ */

export async function keepOnline(
  conn,
  jid
) {

  if (!conn)
    return false


  try {

    if (
      typeof conn.sendPresenceUpdate !==
      'function'
    ) {

      return false
    }


    if (jid) {

      await conn.sendPresenceUpdate(
        'available',
        jid
      )

    } else {

      await conn.sendPresenceUpdate(
        'available'
      )

    }


    return true

  } catch {

    return false

  }
}


/* ══════════════════════════════════════
   PRESENCE HELPERS
══════════════════════════════════════ */

export async function presence(
  conn,
  type,
  jid
) {

  if (
    !conn ||
    typeof conn.sendPresenceUpdate !==
      'function'
  ) {

    return false
  }


  try {

    await conn.sendPresenceUpdate(
      type,
      jid
    )


    return true

  } catch {

    return false

  }
}


export const sendPresence =
  presence


export async function typing(
  conn,
  jid
) {

  return presence(
    conn,
    'composing',
    jid
  )
}


export async function recording(
  conn,
  jid
) {

  return presence(
    conn,
    'recording',
    jid
  )
}


export async function paused(
  conn,
  jid
) {

  return presence(
    conn,
    'paused',
    jid
  )
}


/* ══════════════════════════════════════
   READ MESSAGE
══════════════════════════════════════ */

export async function markRead(
  conn,
  key
) {

  if (
    !conn ||
    typeof conn.readMessages !==
      'function'
  ) {

    return false
  }


  if (!key)
    return false


  try {

    await conn.readMessages([
      key
    ])


    return true

  } catch {

    return false

  }
}


/* ══════════════════════════════════════
   PARTICIPANT HELPERS
══════════════════════════════════════ */

export function participantJid(
  participant
) {

  if (!participant)
    return null


  if (
    typeof participant === 'string'
  ) {

    return participant
  }


  return (
    participant.id ||
    participant.jid ||
    participant.phoneNumber ||
    null
  )
}


export function findParticipant(
  conn,
  participants,
  jid
) {

  if (
    !Array.isArray(participants) ||
    !jid
  ) {

    return null
  }


  return (
    participants.find(
      participant => {

        const pid =
          participantJid(
            participant
          )


        return sameJid(
          conn,
          pid,
          jid
        )
      }
    ) ||
    null
  )
}


/* ══════════════════════════════════════
   FIND BOT PARTICIPANT
══════════════════════════════════════ */

export function findBotParticipant(
  conn,
  participants
) {

  if (
    !Array.isArray(participants)
  ) {

    return null
  }


  const ids = [

    conn?.user?.id,
    conn?.user?.lid,
    conn?.user?.jid

  ].filter(Boolean)


  for (
    const participant of
    participants
  ) {

    const pid =
      participantJid(
        participant
      )


    if (!pid)
      continue


    if (
      ids.some(
        id =>
          sameJid(
            conn,
            id,
            pid
          )
      )
    ) {

      return participant
    }
  }


  /*
   * Fallback: sometimes the
   * participant has our phone number.
   */

  const botNumber =
    cleanNumber(
      conn?.user?.id
    )


  if (botNumber) {

    const found =
      participants.find(
        participant => {

          const pid =
            participantJid(
              participant
            )


          return (
            cleanNumber(pid) ===
            botNumber
          )
        }
      )


    if (found)
      return found
  }


  return null
}


/* ══════════════════════════════════════
   ADMIN
══════════════════════════════════════ */

export function isAdmin(
  participant
) {

  if (!participant)
    return false


  return (
    participant.admin === 'admin' ||
    participant.admin === 'superadmin' ||
    participant.admin === true ||
    participant.isAdmin === true
  )
}


export function isSuperAdmin(
  participant
) {

  if (!participant)
    return false


  return (
    participant.admin ===
      'superadmin' ||
    participant.isSuperAdmin ===
      true
  )
}


export function isBotAdmin(
  conn,
  participants
) {

  const bot =
    findBotParticipant(
      conn,
      participants
    )


  return isAdmin(bot)
}


/* ══════════════════════════════════════
   SEND MESSAGE CORE
══════════════════════════════════════ */

export async function sendMessage(
  conn,
  jid,
  content,
  options = {}
) {

  if (
    !conn ||
    typeof conn.sendMessage !==
      'function'
  ) {

    throw new Error(
      'sendMessage() is not available on this connection.'
    )
  }


  if (!jid)
    throw new Error(
      'Missing destination JID.'
    )


  return conn.sendMessage(
    jid,
    content,
    options
  )
}


/* ══════════════════════════════════════
   QUOTED OPTIONS
══════════════════════════════════════ */

function quotedOptions(
  quoted,
  options = {}
) {

  const result = {
    ...options
  }


  if (
    quoted &&
    !result.quoted
  ) {

    result.quoted =
      quoted
  }


  return result
}


/* ══════════════════════════════════════
   TEXT
══════════════════════════════════════ */

export async function sendText(
  conn,
  jid,
  text,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {
      text:
        String(text ?? ''),
      ...options.content
    },
    options.send
      ? options.send
      : {}
  )
}


/*
 * More convenient method.
 */

export async function reply(
  conn,
  jid,
  text,
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {
      text:
        String(text ?? ''),
      ...options.content
    },
    quotedOptions(
      quoted,
      options.send
    )
  )
}


/* ══════════════════════════════════════
   BUTTONS
══════════════════════════════════════ */

export async function sendButtons(
  conn,
  jid,
  {
    text = '',
    footer,
    buttons = [],
    image,
    video,
    document,
    audio,
    caption,
    ...rest
  } = {},
  quoted,
  options = {}
) {

  const content = {
    ...rest
  }


  if (image)
    content.image = image


  if (video)
    content.video = video


  if (document)
    content.document =
      document


  if (audio)
    content.audio =
      audio


  if (image || video)
    content.caption =
      caption ?? text
  else
    content.text =
      text


  if (footer != null)
    content.footer =
      footer


  content.buttons =
    Array.isArray(buttons)
      ? buttons.map(
          button =>
            normalizeButton(
              button
            )
        )
      : []


  return sendMessage(
    conn,
    jid,
    content,
    quotedOptions(
      quoted,
      options
    )
  )
}


/*
 * Easy form:
 *
 * sendButton(
 *   conn,
 *   jid,
 *   'Hello',
 *   [
 *     ['Menu', '#menu'],
 *     ['Owner', '#owner']
 *   ],
 *   quoted
 * )
 */

export async function sendButton(
  conn,
  jid,
  text,
  buttons = [],
  quoted,
  footer = '',
  options = {}
) {

  return sendButtons(
    conn,
    jid,
    {
      text,
      footer,
      buttons
    },
    quoted,
    options
  )
}


/* ══════════════════════════════════════
   BUTTON NORMALIZER
══════════════════════════════════════ */

export function normalizeButton(
  button
) {

  if (!button)
    return null


  /*
   * Already in Starcore format.
   */

  if (
    typeof button === 'object' &&
    (
      'text' in button ||
      'id' in button
    )
  ) {

    return {
      ...button
    }
  }


  /*
   * [text, id]
   */

  if (
    Array.isArray(button)
  ) {

    return {

      text:
        String(
          button[0] ?? ''
        ),

      id:
        String(
          button[1] ?? button[0] ?? ''
        )

    }
  }


  /*
   * Simple string.
   */

  if (
    typeof button === 'string'
  ) {

    return {

      text:
        button,

      id:
        button

    }
  }


  return null
}


/* ══════════════════════════════════════
   LIST
══════════════════════════════════════ */

export async function sendList(
  conn,
  jid,
  {
    text = '',
    title,
    footer,
    buttonText = 'Select',
    sections = [],
    ...rest
  } = {},
  quoted,
  options = {}
) {

  const content = {

    text,

    ...rest,

    buttonText,

    sections:
      normalizeSections(
        sections
      )

  }


  if (
    title != null
  ) {

    content.title =
      title
  }


  if (
    footer != null
  ) {

    content.footer =
      footer
  }


  return sendMessage(
    conn,
    jid,
    content,
    quotedOptions(
      quoted,
      options
    )
  )
}


/* ══════════════════════════════════════
   SECTION NORMALIZER
══════════════════════════════════════ */

export function normalizeSections(
  sections
) {

  if (
    !Array.isArray(sections)
  ) {

    return []
  }


  return sections.map(
    section => {

      if (
        typeof section ===
        'string'
      ) {

        return {

          title:
            section,

          rows: []

        }
      }


      return {

        ...section,

        rows:
          Array.isArray(
            section?.rows
          )
            ? section.rows.map(
                row =>
                  normalizeRow(
                    row
                  )
              )
            : []

      }
    }
  )
}


export function normalizeRow(
  row
) {

  if (!row)
    return null


  if (
    Array.isArray(row)
  ) {

    return {

      title:
        String(
          row[0] ?? ''
        ),

      description:
        String(
          row[2] ?? ''
        ),

      rowId:
        String(
          row[1] ??
          row[0] ??
          ''
        )

    }
  }


  return {
    ...row,

    rowId:
      row.rowId ??
      row.id ??
      row.title ??
      ''

  }
}


/* ══════════════════════════════════════
   NATIVE FLOW
══════════════════════════════════════ */

export async function sendNativeFlow(
  conn,
  jid,
  {
    text = '',
    caption,
    footer,
    image,
    video,
    document,

    nativeFlow = [],

    optionText,
    optionTitle,

    offerText,
    offerCode,
    offerUrl,
    offerExpiration,

    interactiveAsTemplate,

    ...rest

  } = {},
  quoted,
  options = {}
) {

  const content = {
    ...rest
  }


  if (image)
    content.image =
      image


  if (video)
    content.video =
      video


  if (document)
    content.document =
      document


  if (
    image ||
    video ||
    document
  ) {

    content.caption =
      caption ??
      text

  } else {

    content.text =
      text

  }


  if (
    footer != null
  ) {

    content.footer =
      footer

  }


  if (
    optionText != null
  ) {

    content.optionText =
      optionText

  }


  if (
    optionTitle != null
  ) {

    content.optionTitle =
      optionTitle

  }


  if (
    offerText != null
  ) {

    content.offerText =
      offerText

  }


  if (
    offerCode != null
  ) {

    content.offerCode =
      offerCode

  }


  if (
    offerUrl != null
  ) {

    content.offerUrl =
      offerUrl

  }


  if (
    offerExpiration != null
  ) {

    content.offerExpiration =
      offerExpiration

  }


  if (
    interactiveAsTemplate != null
  ) {

    content.interactiveAsTemplate =
      Boolean(
        interactiveAsTemplate
      )

  }


  content.nativeFlow =
    normalizeNativeFlow(
      nativeFlow
    )


  return sendMessage(
    conn,
    jid,
    content,
    quotedOptions(
      quoted,
      options
    )
  )
}


/* ══════════════════════════════════════
   NATIVE FLOW NORMALIZER
══════════════════════════════════════ */

export function normalizeNativeFlow(
  flows
) {

  if (
    !Array.isArray(flows)
  ) {

    return []
  }


  return flows.map(
    flow => {

      if (
        typeof flow ===
        'string'
      ) {

        return {

          text:
            flow,

          id:
            flow

        }
      }


      if (
        Array.isArray(flow)
      ) {

        return {

          text:
            String(
              flow[0] ?? ''
            ),

          id:
            String(
              flow[1] ??
              flow[0] ??
              ''
            )

        }
      }


      const item = {
        ...flow
      }


      if (
        Array.isArray(
          item.sections
        )
      ) {

        item.sections =
          normalizeSections(
            item.sections
          )
      }


      return item
    }
  )
}


/* ══════════════════════════════════════
   CAROUSEL
══════════════════════════════════════ */

export async function sendCarousel(
  conn,
  jid,
  {
    text = '',
    footer,
    cards = [],
    ...rest
  } = {},
  quoted,
  options = {}
) {

  const content = {

    text,

    ...rest,

    cards:
      Array.isArray(cards)
        ? cards.map(
            normalizeCard
          )
        : []

  }


  if (
    footer != null
  ) {

    content.footer =
      footer

  }


  return sendMessage(
    conn,
    jid,
    content,
    quotedOptions(
      quoted,
      options
    )
  )
}


function normalizeCard(
  card
) {

  if (!card)
    return card


  const result = {
    ...card
  }


  if (
    Array.isArray(
      result.nativeFlow
    )
  ) {

    result.nativeFlow =
      normalizeNativeFlow(
        result.nativeFlow
      )
  }


  if (
    Array.isArray(
      result.sections
    )
  ) {

    result.sections =
      normalizeSections(
        result.sections
      )
  }


  return result
}


/* ══════════════════════════════════════
   MEDIA
══════════════════════════════════════ */

export async function sendImage(
  conn,
  jid,
  image,
  caption = '',
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {
      image,
      caption,
      ...options.content
    },
    quotedOptions(
      quoted,
      options.send
    )
  )
}


export async function sendVideo(
  conn,
  jid,
  video,
  caption = '',
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {
      video,
      caption,
      ...options.content
    },
    quotedOptions(
      quoted,
      options.send
    )
  )
}


export async function sendAudio(
  conn,
  jid,
  audio,
  ptt = false,
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {
      audio,
      ptt,
      ...options.content
    },
    quotedOptions(
      quoted,
      options.send
    )
  )
}


export async function sendDocument(
  conn,
  jid,
  document,
  mimetype,
  fileName = '',
  caption = '',
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {
      document,
      mimetype,
      fileName,
      caption,
      ...options.content
    },
    quotedOptions(
      quoted,
      options.send
    )
  )
}


export async function sendSticker(
  conn,
  jid,
  sticker,
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {
      sticker,
      ...options.content
    },
    quotedOptions(
      quoted,
      options.send
    )
  )
}


/* ══════════════════════════════════════
   ALBUM
══════════════════════════════════════ */

export async function sendAlbum(
  conn,
  jid,
  album,
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {
      album:
        Array.isArray(album)
          ? album
          : []
    },
    quotedOptions(
      quoted,
      options
    )
  )
}


/* ══════════════════════════════════════
   STICKER PACK
══════════════════════════════════════ */

export async function sendStickerPack(
  conn,
  jid,
  {
    cover,
    stickers = [],
    name,
    publisher,
    description,
    ...rest
  } = {},
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {
      cover,

      stickers,

      name,

      publisher,

      description,

      ...rest
    },
    quotedOptions(
      quoted,
      options
    )
  )
}


/* ══════════════════════════════════════
   POLL
══════════════════════════════════════ */

export async function sendPoll(
  conn,
  jid,
  {
    name,
    values = [],
    selectableCount = 1,
    ...rest
  } = {},
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {
      poll: {

        name,

        values,

        selectableCount,

        ...rest

      }
    },
    quotedOptions(
      quoted,
      options
    )
  )
}


export async function sendPollResult(
  conn,
  jid,
  pollResult,
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {
      pollResult
    },
    quotedOptions(
      quoted,
      options
    )
  )
}


/* ══════════════════════════════════════
   CONTACT
══════════════════════════════════════ */

export function makeVCard({
  name,
  number,
  organization = '',
  waid
} = {}) {

  const clean =
    cleanNumber(number)


  const finalWaid =
    waid ||
    clean


  return (
    'BEGIN:VCARD\n' +
    'VERSION:3.0\n' +
    `FN:${name || clean}\n` +
    (
      organization
        ? `ORG:${organization};\n`
        : ''
    ) +
    `TEL;type=CELL;type=VOICE;waid=${finalWaid}:+${clean}\n` +
    'END:VCARD'
  )
}


export async function sendContact(
  conn,
  jid,
  {
    displayName,
    contacts = []
  } = {},
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {
      contacts: {

        displayName,

        contacts

      }
    },
    quotedOptions(
      quoted,
      options
    )
  )
}


/* ══════════════════════════════════════
   LOCATION
══════════════════════════════════════ */

export async function sendLocation(
  conn,
  jid,
  {
    degreesLatitude,
    degreesLongitude,
    name,
    address,
    url
  } = {},
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {
      location: {

        degreesLatitude,

        degreesLongitude,

        name,

        address,

        url

      }
    },
    quotedOptions(
      quoted,
      options
    )
  )
}


/* ══════════════════════════════════════
   EVENT
══════════════════════════════════════ */

export async function sendEvent(
  conn,
  jid,
  event,
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {
      event
    },
    quotedOptions(
      quoted,
      options
    )
  )
}


/* ══════════════════════════════════════
   GROUP INVITE
══════════════════════════════════════ */

export function extractInviteCode(
  url
) {

  if (!url)
    return null


  const match =
    String(url).match(
      /chat\.whatsapp\.com\/([^?]+)/i
    )


  return (
    match?.[1] ||
    null
  )
}


export async function sendGroupInvite(
  conn,
  jid,
  {
    inviteCode,
    inviteUrl,
    inviteExpiration,
    text = '',
    groupJid,
    subject,
    ...rest
  } = {},
  quoted,
  options = {}
) {

  const code =
    inviteCode ||
    extractInviteCode(
      inviteUrl
    )


  return sendMessage(
    conn,
    jid,
    {
      groupInvite: {

        inviteCode:
          code,

        inviteExpiration:
          inviteExpiration ||
          (
            Date.now() +
            86400000
          ),

        text,

        jid:
          groupJid,

        subject,

        ...rest

      }
    },
    quotedOptions(
      quoted,
      options
    )
  )
}


/* ══════════════════════════════════════
   PRODUCT
══════════════════════════════════════ */

export async function sendProduct(
  conn,
  jid,
  {
    product,
    image,
    body,
    footer,
    businessOwnerJid,
    ...rest
  } = {},
  quoted,
  options = {}
) {

  const content = {

    ...rest,

    product,

    businessOwnerJid

  }


  if (image)
    content.image =
      image


  if (body != null)
    content.body =
      body


  if (footer != null)
    content.footer =
      footer


  return sendMessage(
    conn,
    jid,
    content,
    quotedOptions(
      quoted,
      options
    )
  )
}


/* ══════════════════════════════════════
   RICH RESPONSE
══════════════════════════════════════ */

export async function sendRichResponse(
  conn,
  jid,
  {
    richResponse = [],
    disclaimerText,
    ...rest
  } = {},
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {
      richResponse,

      disclaimerText,

      ...rest

    },
    quotedOptions(
      quoted,
      options
    )
  )
}


/* ══════════════════════════════════════
   CODE BLOCK
══════════════════════════════════════ */

export async function sendCode(
  conn,
  jid,
  {
    code,
    language = 'javascript',
    disclaimerText,
    headerText,
    contentText,
    footerText
  } = {},
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {

      code,

      language,

      disclaimerText,

      headerText,

      contentText,

      footerText

    },
    quotedOptions(
      quoted,
      options
    )
  )
}


/* ══════════════════════════════════════
   INLINE ENTITIES
══════════════════════════════════════ */

export async function sendInlineEntities(
  conn,
  jid,
  {
    links = [],
    disclaimerText,
    headerText,
    contentText,
    footerText
  } = {},
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {

      links,

      disclaimerText,

      headerText,

      contentText,

      footerText

    },
    quotedOptions(
      quoted,
      options
    )
  )
}


/* ══════════════════════════════════════
   TABLE
══════════════════════════════════════ */

export async function sendTable(
  conn,
  jid,
  {
    table = [],
    title,
    noHeading = false,
    disclaimerText,
    headerText,
    contentText,
    footerText
  } = {},
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {

      table,

      title,

      noHeading,

      disclaimerText,

      headerText,

      contentText,

      footerText

    },
    quotedOptions(
      quoted,
      options
    )
  )
}


/* ══════════════════════════════════════
   REACTION
══════════════════════════════════════ */

export async function react(
  conn,
  jid,
  key,
  text = ''
) {

  return sendMessage(
    conn,
    jid,
    {
      react: {

        key,

        text

      }
    }
  )
}


/* ══════════════════════════════════════
   PIN
══════════════════════════════════════ */

export async function pinMessage(
  conn,
  jid,
  key,
  time = 86400,
  type = 1
) {

  return sendMessage(
    conn,
    jid,
    {

      pin:
        key,

      time,

      type

    }
  )
}


/* ══════════════════════════════════════
   KEEP
══════════════════════════════════════ */

export async function keepMessage(
  conn,
  jid,
  key,
  type = 1
) {

  return sendMessage(
    conn,
    jid,
    {

      keep:
        key,

      type

    }
  )
}


/* ══════════════════════════════════════
   FORWARD
══════════════════════════════════════ */

export async function forwardMessage(
  conn,
  jid,
  message,
  force = false
) {

  return sendMessage(
    conn,
    jid,
    {

      forward:
        message,

      force

    }
  )
}


/* ══════════════════════════════════════
   BUTTON RESPONSE
══════════════════════════════════════ */

export async function sendButtonResponse(
  conn,
  jid,
  {
    id,
    displayText = '',
    type = 'plain'
  } = {},
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {

      type,

      buttonReply: {

        id,

        displayText

      }

    },
    quotedOptions(
      quoted,
      options
    )
  )
}


/* ══════════════════════════════════════
   LIST RESPONSE
══════════════════════════════════════ */

export async function sendListResponse(
  conn,
  jid,
  {
    id,
    title = '',
    description = ''
  } = {},
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {

      listReply: {

        title,

        description,

        id

      }

    },
    quotedOptions(
      quoted,
      options
    )
  )
}


/* ══════════════════════════════════════
   FLOW RESPONSE
══════════════════════════════════════ */

export async function sendFlowResponse(
  conn,
  jid,
  {
    id,
    text = '',
    name = 'menu_options',
    format = 0,
    params = {}
  } = {},
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {

      flowReply: {

        format,

        text,

        name,

        paramsJson:
          typeof params === 'string'
            ? params
            : JSON.stringify(
                {
                  id,
                  description:
                    text,
                  ...params
                }
              )

      }

    },
    quotedOptions(
      quoted,
      options
    )
  )
}


/* ══════════════════════════════════════
   TEMPLATE RESPONSE
══════════════════════════════════════ */

export async function sendTemplateResponse(
  conn,
  jid,
  {
    id,
    displayText = '',
    index = 0
  } = {},
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {

      type:
        'template',

      buttonReply: {

        id,

        displayText,

        index

      }

    },
    quotedOptions(
      quoted,
      options
    )
  )
}


/* ══════════════════════════════════════
   DELETE MESSAGE
══════════════════════════════════════ */

export async function deleteMessage(
  conn,
  jid,
  key
) {

  return sendMessage(
    conn,
    jid,
    {
      delete:
        key
    }
  )
}


/* ══════════════════════════════════════
   EDIT MESSAGE
══════════════════════════════════════ */

export async function editMessage(
  conn,
  jid,
  key,
  text,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {

      text,

      edit:
        key,

      ...options.content

    }
  )
}


/* ══════════════════════════════════════
   MENTION ALL
══════════════════════════════════════ */

export async function mentionAll(
  conn,
  jid,
  text,
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {

      text,

      mentionAll:
        true,

      ...options.content

    },
    quotedOptions(
      quoted,
      options.send
    )
  )
}


/* ══════════════════════════════════════
   EXTERNAL AD REPLY
══════════════════════════════════════ */

export async function sendExternalAd(
  conn,
  jid,
  {
    text = '',
    title = '',
    body = '',
    thumbnailUrl,
    mediaUrl,
    mediaType = 1,
    renderLargerThumbnail = false,
    sourceUrl,
    ...rest
  } = {},
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {

      text,

      ...rest,

      externalAdReply: {

        title,

        body,

        thumbnailUrl,

        mediaUrl,

        mediaType,

        renderLargerThumbnail,

        sourceUrl

      }

    },
    quotedOptions(
      quoted,
      options
    )
  )
}


/* ══════════════════════════════════════
   SPECIAL MESSAGE OPTIONS
══════════════════════════════════════ */

export async function sendAdvanced(
  conn,
  jid,
  content = {},
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {
      ...content
    },
    quotedOptions(
      quoted,
      options
    )
  )
}


/*
 * Generic wrapper for:
 *
 * ai
 * ephemeral
 * groupStatus
 * isLottie
 * spoiler
 * viewOnce
 * viewOnceV2
 * viewOnceV2Extension
 * secureMetaServiceLabel
 * interactiveAsTemplate
 * mentionAll
 * raw
 *
 * We don't transform them because
 * Starcore itself handles them.
 */

export async function sendWithOptions(
  conn,
  jid,
  content = {},
  {
    quoted,
    ...sendOptions
  } = {}
) {

  return sendMessage(
    conn,
    jid,
    content,
    {
      ...sendOptions,
      ...(quoted
        ? { quoted }
        : {})
    }
  )
}


/* ══════════════════════════════════════
   VIEW ONCE
══════════════════════════════════════ */

export async function sendViewOnce(
  conn,
  jid,
  content = {},
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {

      ...content,

      viewOnce:
        true

    },
    quotedOptions(
      quoted,
      options
    )
  )
}


export async function sendViewOnceV2(
  conn,
  jid,
  content = {},
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {

      ...content,

      viewOnceV2:
        true

    },
    quotedOptions(
      quoted,
      options
    )
  )
}


/* ══════════════════════════════════════
   SPOILER
══════════════════════════════════════ */

export async function sendSpoiler(
  conn,
  jid,
  content = {},
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {

      ...content,

      spoiler:
        true

    },
    quotedOptions(
      quoted,
      options
    )
  )
}


/* ══════════════════════════════════════
   EPHEMERAL
══════════════════════════════════════ */

export async function sendEphemeral(
  conn,
  jid,
  content = {},
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {

      ...content,

      ephemeral:
        true

    },
    quotedOptions(
      quoted,
      options
    )
  )
}


/* ══════════════════════════════════════
   GROUP STATUS
══════════════════════════════════════ */

export async function sendGroupStatus(
  conn,
  jids,
  content = {},
  options = {}
) {

  return sendMessage(
    conn,
    jids,
    {

      ...content,

      groupStatus:
        true

    },
    options
  )
}


/* ══════════════════════════════════════
   RAW
══════════════════════════════════════ */

export async function sendRaw(
  conn,
  jid,
  content = {},
  quoted,
  options = {}
) {

  return sendMessage(
    conn,
    jid,
    {

      raw:
        content

    },
    quotedOptions(
      quoted,
      options
    )
  )
}


/* ══════════════════════════════════════
   INSTALL METHODS ON CONNECTION
══════════════════════════════════════ */

/*
 * This is optional.
 *
 * If you call:
 *
 * installWhatsAppHelpers(conn)
 *
 * you can then use:
 *
 * conn.sendButton(...)
 * conn.sendList(...)
 * conn.sendNativeFlow(...)
 * conn.sendCarousel(...)
 * conn.sendPoll(...)
 * ...
 *
 * This keeps plugins simple.
 */

export function installWhatsAppHelpers(
  conn
) {

  if (!conn)
    return conn


  if (
    conn.__ayanaWhatsAppHelpers
  ) {

    return conn
  }


  Object.defineProperties(
    conn,
    {

      __ayanaWhatsAppHelpers: {

        value: true,

        enumerable: false,

        configurable: false,

        writable: false

      },


      sendText: {

        value:
          (
            jid,
            text,
            quoted,
            options
          ) =>
            reply(
              conn,
              jid,
              text,
              quoted,
              options
            ),

        enumerable: false

      },


      sendButton: {

        value:
          (
            jid,
            text,
            buttons,
            quoted,
            footer,
            options
          ) =>
            sendButton(
              conn,
              jid,
              text,
              buttons,
              quoted,
              footer,
              options
            ),

        enumerable: false

      },


      sendButtons: {

        value:
          (
            jid,
            data,
            quoted,
            options
          ) =>
            sendButtons(
              conn,
              jid,
              data,
              quoted,
              options
            ),

        enumerable: false

      },


      sendList: {

        value:
          (
            jid,
            data,
            quoted,
            options
          ) =>
            sendList(
              conn,
              jid,
              data,
              quoted,
              options
            ),

        enumerable: false

      },


      sendNativeFlow: {

        value:
          (
            jid,
            data,
            quoted,
            options
          ) =>
            sendNativeFlow(
              conn,
              jid,
              data,
              quoted,
              options
            ),

        enumerable: false

      },


      sendCarousel: {

        value:
          (
            jid,
            data,
            quoted,
            options
          ) =>
            sendCarousel(
              conn,
              jid,
              data,
              quoted,
              options
            ),

        enumerable: false

      },


      sendImage: {

        value:
          (
            jid,
            image,
            caption,
            quoted,
            options
          ) =>
            sendImage(
              conn,
              jid,
              image,
              caption,
              quoted,
              options
            ),

        enumerable: false

      },


      sendVideo: {

        value:
          (
            jid,
            video,
            caption,
            quoted,
            options
          ) =>
            sendVideo(
              conn,
              jid,
              video,
              caption,
              quoted,
              options
            ),

        enumerable: false

      },


      sendAudio: {

        value:
          (
            jid,
            audio,
            ptt,
            quoted,
            options
          ) =>
            sendAudio(
              conn,
              jid,
              audio,
              ptt,
              quoted,
              options
            ),

        enumerable: false

      },


      sendDocument: {

        value:
          (
            jid,
            document,
            mimetype,
            fileName,
            caption,
            quoted,
            options
          ) =>
            sendDocument(
              conn,
              jid,
              document,
              mimetype,
              fileName,
              caption,
              quoted,
              options
            ),

        enumerable: false

      },


      sendSticker: {

        value:
          (
            jid,
            sticker,
            quoted,
            options
          ) =>
            sendSticker(
              conn,
              jid,
              sticker,
              quoted,
              options
            ),

        enumerable: false

      },


      sendAlbum: {

        value:
          (
            jid,
            album,
            quoted,
            options
          ) =>
            sendAlbum(
              conn,
              jid,
              album,
              quoted,
              options
            ),

        enumerable: false

      },


      sendStickerPack: {

        value:
          (
            jid,
            data,
            quoted,
            options
          ) =>
            sendStickerPack(
              conn,
              jid,
              data,
              quoted,
              options
            ),

        enumerable: false

      },


      sendPoll: {

        value:
          (
            jid,
            data,
            quoted,
            options
          ) =>
            sendPoll(
              conn,
              jid,
              data,
              quoted,
              options
            ),

        enumerable: false

      },


      sendContact: {

        value:
          (
            jid,
            data,
            quoted,
            options
          ) =>
            sendContact(
              conn,
              jid,
              data,
              quoted,
              options
            ),

        enumerable: false

      },


      sendLocation: {

        value:
          (
            jid,
            data,
            quoted,
            options
          ) =>
            sendLocation(
              conn,
              jid,
              data,
              quoted,
              options
            ),

        enumerable: false

      },


      sendEvent: {

        value:
          (
            jid,
            data,
            quoted,
            options
          ) =>
            sendEvent(
              conn,
              jid,
              data,
              quoted,
              options
            ),

        enumerable: false

      },


      sendGroupInvite: {

        value:
          (
            jid,
            data,
            quoted,
            options
          ) =>
            sendGroupInvite(
              conn,
              jid,
              data,
              quoted,
              options
            ),

        enumerable: false

      },


      sendProduct: {

        value:
          (
            jid,
            data,
            quoted,
            options
          ) =>
            sendProduct(
              conn,
              jid,
              data,
              quoted,
              options
            ),

        enumerable: false

      },


      sendRichResponse: {

        value:
          (
            jid,
            data,
            quoted,
            options
          ) =>
            sendRichResponse(
              conn,
              jid,
              data,
              quoted,
              options
            ),

        enumerable: false

      },


      sendCode: {

        value:
          (
            jid,
            data,
            quoted,
            options
          ) =>
            sendCode(
              conn,
              jid,
              data,
              quoted,
              options
            ),

        enumerable: false

      },


      sendTable: {

        value:
          (
            jid,
            data,
            quoted,
            options
          ) =>
            sendTable(
              conn,
              jid,
              data,
              quoted,
              options
            ),

        enumerable: false

      },


      sendInlineEntities: {

        value:
          (
            jid,
            data,
            quoted,
            options
          ) =>
            sendInlineEntities(
              conn,
              jid,
              data,
              quoted,
              options
            ),

        enumerable: false

      },


      sendButtonResponse: {

        value:
          (
            jid,
            data,
            quoted,
            options
          ) =>
            sendButtonResponse(
              conn,
              jid,
              data,
              quoted,
              options
            ),

        enumerable: false

      },


      sendListResponse: {

        value:
          (
            jid,
            data,
            quoted,
            options
          ) =>
            sendListResponse(
              conn,
              jid,
              data,
              quoted,
              options
            ),

        enumerable: false

      },


      sendFlowResponse: {

        value:
          (
            jid,
            data,
            quoted,
            options
          ) =>
            sendFlowResponse(
              conn,
              jid,
              data,
              quoted,
              options
            ),

        enumerable: false

      },


      sendTemplateResponse: {

        value:
          (
            jid,
            data,
            quoted,
            options
          ) =>
            sendTemplateResponse(
              conn,
              jid,
              data,
              quoted,
              options
            ),

        enumerable: false

      },


      react: {

        value:
          (
            jid,
            key,
            text
          ) =>
            react(
              conn,
              jid,
              key,
              text
            ),

        enumerable: false

      },


      pinMessage: {

        value:
          (
            jid,
            key,
            time,
            type
          ) =>
            pinMessage(
              conn,
              jid,
              key,
              time,
              type
            ),

        enumerable: false

      },


      keepMessage: {

        value:
          (
            jid,
            key,
            type
          ) =>
            keepMessage(
              conn,
              jid,
              key,
              type
            ),

        enumerable: false

      },


      forwardMessage: {

        value:
          (
            jid,
            message,
            force
          ) =>
            forwardMessage(
              conn,
              jid,
              message,
              force
            ),

        enumerable: false

      },


      deleteMessage: {

        value:
          (
            jid,
            key
          ) =>
            deleteMessage(
              conn,
              jid,
              key
            ),

        enumerable: false

      },


      editMessage: {

        value:
          (
            jid,
            key,
            text,
            options
          ) =>
            editMessage(
              conn,
              jid,
              key,
              text,
              options
            ),

        enumerable: false

      },


      mentionAll: {

        value:
          (
            jid,
            text,
            quoted,
            options
          ) =>
            mentionAll(
              conn,
              jid,
              text,
              quoted,
              options
            ),

        enumerable: false

      },


      sendViewOnce: {

        value:
          (
            jid,
            content,
            quoted,
            options
          ) =>
            sendViewOnce(
              conn,
              jid,
              content,
              quoted,
              options
            ),

        enumerable: false

      },


      sendSpoiler: {

        value:
          (
            jid,
            content,
            quoted,
            options
          ) =>
            sendSpoiler(
              conn,
              jid,
              content,
              quoted,
              options
            ),

        enumerable: false

      },


      sendEphemeral: {

        value:
          (
            jid,
            content,
            quoted,
            options
          ) =>
            sendEphemeral(
              conn,
              jid,
              content,
              quoted,
              options
            ),

        enumerable: false

      },


      sendAdvanced: {

        value:
          (
            jid,
            content,
            quoted,
            options
          ) =>
            sendAdvanced(
              conn,
              jid,
              content,
              quoted,
              options
            ),

        enumerable: false

      }

    }
  )


  return conn
}


/* ══════════════════════════════════════
   INSTALL HELPERS ON MESSAGE OBJECT
══════════════════════════════════════ */

/*
 * Optional helper for smsg().
 *
 * Usage:
 *
 * installMessageHelpers(m, conn)
 *
 * Then:
 *
 * await m.sendButton(...)
 * await m.sendList(...)
 * await m.sendNativeFlow(...)
 */

export function installMessageHelpers(
  m,
  conn
) {

  if (!m || !conn)
    return m


  if (
    m.__ayanaMessageHelpers
  ) {

    return m
  }


  Object.defineProperty(
    m,
    '__ayanaMessageHelpers',
    {
      value: true,
      enumerable: false
    }
  )


  m.sendText =
    (
      text,
      options = {}
    ) =>
      reply(
        conn,
        m.chat,
        text,
        m,
        options
      )


  m.sendButton =
    (
      text,
      buttons,
      footer = '',
      options = {}
    ) =>
      sendButton(
        conn,
        m.chat,
        text,
        buttons,
        m,
        footer,
        options
      )


  m.sendButtons =
    (
      data,
      options = {}
    ) =>
      sendButtons(
        conn,
        m.chat,
        data,
        m,
        options
      )


  m.sendList =
    (
      data,
      options = {}
    ) =>
      sendList(
        conn,
        m.chat,
        data,
        m,
        options
      )


  m.sendNativeFlow =
    (
      data,
      options = {}
    ) =>
      sendNativeFlow(
        conn,
        m.chat,
        data,
        m,
        options
      )


  m.sendCarousel =
    (
      data,
      options = {}
    ) =>
      sendCarousel(
        conn,
        m.chat,
        data,
        m,
        options
      )


  m.sendImage =
    (
      image,
      caption = '',
      options = {}
    ) =>
      sendImage(
        conn,
        m.chat,
        image,
        caption,
        m,
        options
      )


  m.sendVideo =
    (
      video,
      caption = '',
      options = {}
    ) =>
      sendVideo(
        conn,
        m.chat,
        video,
        caption,
        m,
        options
      )


  m.sendAudio =
    (
      audio,
      ptt = false,
      options = {}
    ) =>
      sendAudio(
        conn,
        m.chat,
        audio,
        ptt,
        m,
        options
      )


  m.sendDocument =
    (
      document,
      mimetype,
      fileName = '',
      caption = '',
      options = {}
    ) =>
      sendDocument(
        conn,
        m.chat,
        document,
        mimetype,
        fileName,
        caption,
        m,
        options
      )


  m.sendSticker =
    (
      sticker,
      options = {}
    ) =>
      sendSticker(
        conn,
        m.chat,
        sticker,
        m,
        options
      )


  m.sendAlbum =
    (
      album,
      options = {}
    ) =>
      sendAlbum(
        conn,
        m.chat,
        album,
        m,
        options
      )


  m.sendStickerPack =
    (
      data,
      options = {}
    ) =>
      sendStickerPack(
        conn,
        m.chat,
        data,
        m,
        options
      )


  m.sendPoll =
    (
      data,
      options = {}
    ) =>
      sendPoll(
        conn,
        m.chat,
        data,
        m,
        options
      )


  m.sendContact =
    (
      data,
      options = {}
    ) =>
      sendContact(
        conn,
        m.chat,
        data,
        m,
        options
      )


  m.sendLocation =
    (
      data,
      options = {}
    ) =>
      sendLocation(
        conn,
        m.chat,
        data,
        m,
        options
      )


  m.sendEvent =
    (
      data,
      options = {}
    ) =>
      sendEvent(
        conn,
        m.chat,
        data,
        m,
        options
      )


  m.sendGroupInvite =
    (
      data,
      options = {}
    ) =>
      sendGroupInvite(
        conn,
        m.chat,
        data,
        m,
        options
      )


  m.sendProduct =
    (
      data,
      options = {}
    ) =>
      sendProduct(
        conn,
        m.chat,
        data,
        m,
        options
      )


  m.sendRichResponse =
    (
      data,
      options = {}
    ) =>
      sendRichResponse(
        conn,
        m.chat,
        data,
        m,
        options
      )


  m.sendCode =
    (
      data,
      options = {}
    ) =>
      sendCode(
        conn,
        m.chat,
        data,
        m,
        options
      )


  m.sendTable =
    (
      data,
      options = {}
    ) =>
      sendTable(
        conn,
        m.chat,
        data,
        m,
        options
      )


  m.sendInlineEntities =
    (
      data,
      options = {}
    ) =>
      sendInlineEntities(
        conn,
        m.chat,
        data,
        m,
        options
      )


  m.react =
    text =>
      react(
        conn,
        m.chat,
        m.key,
        text
      )


  m.pin =
    (
      time = 86400,
      type = 1
    ) =>
      pinMessage(
        conn,
        m.chat,
        m.key,
        time,
        type
      )


  m.keep =
    (
      type = 1
    ) =>
      keepMessage(
        conn,
        m.chat,
        m.key,
        type
      )


  m.forward =
    (
      jid,
      force = false
    ) =>
      forwardMessage(
        conn,
        jid,
        m,
        force
      )


  m.delete =
    () =>
      deleteMessage(
        conn,
        m.chat,
        m.key
      )


  m.edit =
    (
      text,
      options = {}
    ) =>
      editMessage(
        conn,
        m.chat,
        m.key,
        text,
        options
      )


  m.mentionAll =
    (
      text,
      options = {}
    ) =>
      mentionAll(
        conn,
        m.chat,
        text,
        m,
        options
      )


  m.sendViewOnce =
    (
      content,
      options = {}
    ) =>
      sendViewOnce(
        conn,
        m.chat,
        content,
        m,
        options
      )


  m.sendSpoiler =
    (
      content,
      options = {}
    ) =>
      sendSpoiler(
        conn,
        m.chat,
        content,
        m,
        options
      )


  m.sendEphemeral =
    (
      content,
      options = {}
    ) =>
      sendEphemeral(
        conn,
        m.chat,
        content,
        m,
        options
      )


  m.sendAdvanced =
    (
      content,
      options = {}
    ) =>
      sendAdvanced(
        conn,
        m.chat,
        content,
        m,
        options
      )


  return m
}


/* ══════════════════════════════════════
   DEFAULT EXPORT
══════════════════════════════════════ */

export default {

  isJid,
  jidType,

  isLid,
  isPn,
  isGroupJid,
  isNewsletterJid,
  isBroadcastJid,
  isStatusJid,

  cleanNumber,
  jidFromNumber,
  normalizeJid,

  getRealJid,
  sameJid,

  normalizeQuoted,

  keepOnline,
  presence,
  sendPresence,
  typing,
  recording,
  paused,

  markRead,

  participantJid,
  findParticipant,
  findBotParticipant,

  isAdmin,
  isSuperAdmin,
  isBotAdmin,

  sendMessage,
  sendText,
  reply,

  sendButton,
  sendButtons,
  sendList,
  sendNativeFlow,
  sendCarousel,

  sendImage,
  sendVideo,
  sendAudio,
  sendDocument,
  sendSticker,
  sendAlbum,
  sendStickerPack,

  sendPoll,
  sendPollResult,

  sendContact,
  sendLocation,
  sendEvent,
  sendGroupInvite,
  sendProduct,

  sendRichResponse,
  sendCode,
  sendTable,
  sendInlineEntities,

  react,
  pinMessage,
  keepMessage,
  forwardMessage,

  sendButtonResponse,
  sendListResponse,
  sendFlowResponse,
  sendTemplateResponse,

  deleteMessage,
  editMessage,

  mentionAll,

  sendExternalAd,

  sendAdvanced,
  sendWithOptions,

  sendViewOnce,
  sendViewOnceV2,
  sendSpoiler,
  sendEphemeral,
  sendGroupStatus,
  sendRaw,

  installWhatsAppHelpers,
  installMessageHelpers,

  makeVCard,
  extractInviteCode,

  normalizeButton,
  normalizeSections,
  normalizeRow,
  normalizeNativeFlow

}