/*
 * lib/whatsapp.js
 * AYANA MD
 *
 * WhatsApp helpers for:
 * @itsliaaa/baileys
 * @itsliaaa/starcore
 *
 * Supports:
 * - JID / LID helpers
 * - Presence
 * - Read messages
 * - Participants / admins
 * - Text / reply
 * - Buttons
 * - Native Flow
 * - Lists
 * - Carousel
 * - Media
 * - Albums
 * - Sticker packs
 * - Polls
 * - Contacts
 * - Locations
 * - Events
 * - Group invites
 * - Products
 * - Rich responses
 * - Code / tables / inline entities
 * - Reactions
 * - Pin / keep / forward
 * - Message responses
 * - Delete / edit
 * - Mentions
 * - External ads
 * - View once / spoiler / ephemeral
 * - Group status
 * - Raw messages
 *
 * Buttons and Native Flow are kept separate.
 */


/* ══════════════════════════════════════
   JID HELPERS
══════════════════════════════════════ */

export const isJid = jid =>
  typeof jid === 'string' &&
  jid.includes('@')

export const jidType = jid => {
  if (typeof jid !== 'string' || !jid)
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
   NUMBER
══════════════════════════════════════ */

export function cleanNumber(value) {
  if (value == null)
    return ''

  return String(value)
    .replace(/\D/g, '')
}

export function jidFromNumber(number) {
  const clean = cleanNumber(number)

  if (!clean)
    return null

  return `${clean}@s.whatsapp.net`
}

export function normalizeJid(jid) {
  if (!jid)
    return jid

  if (typeof jid !== 'string')
    return jid

  if (jid.includes('@'))
    return jid

  return jidFromNumber(jid) || jid
}


/* ══════════════════════════════════════
   REAL JID / LID
══════════════════════════════════════ */

/*
 * This function intentionally does NOT convert LID -> PN.
 *
 * LID resolution should be done by Baileys itself
 * when the library provides a mapping.
 */
export function getRealJid(conn, jid) {
  if (!jid)
    return jid

  if (typeof jid !== 'string')
    return jid

  if (jid.includes('@'))
    return jid

  return normalizeJid(jid)
}

export function sameJid(conn, a, b) {
  if (!a || !b)
    return false

  const A = String(a)
  const B = String(b)

  if (A === B)
    return true

  /*
   * Never compare LIDs with phone numbers.
   */
  if (isLid(A) || isLid(B))
    return A === B

  /*
   * Special JIDs must stay exact.
   */
  if (
    isGroupJid(A) ||
    isGroupJid(B) ||
    isNewsletterJid(A) ||
    isNewsletterJid(B) ||
    isBroadcastJid(A) ||
    isBroadcastJid(B) ||
    isStatusJid(A) ||
    isStatusJid(B)
  ) {
    return A === B
  }

  return normalizeJid(A) === normalizeJid(B)
}


/* ══════════════════════════════════════
   QUOTED
══════════════════════════════════════ */

export function normalizeQuoted(message) {
  return message || null
}

function quotedOptions(quoted, options = {}) {
  const result = {
    ...(options || {})
  }

  if (quoted && !result.quoted)
    result.quoted = quoted

  return result
}


/* ══════════════════════════════════════
   PRESENCE
══════════════════════════════════════ */

export async function presence(conn, type, jid) {
  if (
    !conn ||
    typeof conn.sendPresenceUpdate !== 'function'
  ) {
    return false
  }

  try {
    await conn.sendPresenceUpdate(type, jid)
    return true
  } catch {
    return false
  }
}

export const sendPresence = presence

export async function keepOnline(conn, jid) {
  return presence(
    conn,
    'available',
    jid
  )
}

export async function typing(conn, jid) {
  return presence(
    conn,
    'composing',
    jid
  )
}

export async function recording(conn, jid) {
  return presence(
    conn,
    'recording',
    jid
  )
}

export async function paused(conn, jid) {
  return presence(
    conn,
    'paused',
    jid
  )
}


/* ══════════════════════════════════════
   READ
══════════════════════════════════════ */

export async function markRead(conn, key) {
  if (
    !conn ||
    typeof conn.readMessages !== 'function' ||
    !key
  ) {
    return false
  }

  try {
    await conn.readMessages([key])
    return true
  } catch {
    return false
  }
}


/* ══════════════════════════════════════
   PARTICIPANTS
══════════════════════════════════════ */

export function participantJid(participant) {
  if (!participant)
    return null

  if (typeof participant === 'string')
    return participant

  return (
    participant.id ||
    participant.jid ||
    participant.phoneNumber ||
    participant.lid ||
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
    participants.find(participant =>
      sameJid(
        conn,
        participantJid(participant),
        jid
      )
    ) || null
  )
}

export function findBotParticipant(
  conn,
  participants
) {
  if (!Array.isArray(participants))
    return null

  const ids = [
    conn?.user?.id,
    conn?.user?.lid,
    conn?.user?.jid
  ].filter(Boolean)

  for (const participant of participants) {
    const pid = participantJid(participant)

    if (!pid)
      continue

    if (
      ids.some(id =>
        sameJid(conn, id, pid)
      )
    ) {
      return participant
    }
  }

  return null
}

export function isAdmin(participant) {
  if (!participant)
    return false

  return (
    participant.admin === 'admin' ||
    participant.admin === 'superadmin' ||
    participant.admin === true ||
    participant.isAdmin === true
  )
}

export function isSuperAdmin(participant) {
  if (!participant)
    return false

  return (
    participant.admin === 'superadmin' ||
    participant.isSuperAdmin === true
  )
}

export function isBotAdmin(conn, participants) {
  return isAdmin(
    findBotParticipant(
      conn,
      participants
    )
  )
}


/* ══════════════════════════════════════
   CORE SEND
══════════════════════════════════════ */

export async function sendMessage(
  conn,
  jid,
  content,
  options = {}
) {
  if (
    !conn ||
    typeof conn.sendMessage !== 'function'
  ) {
    throw new Error(
      'conn.sendMessage() is not available.'
    )
  }

  if (!jid)
    throw new Error(
      'Missing destination JID.'
    )

  if (
    content == null ||
    typeof content !== 'object'
  ) {
    throw new TypeError(
      'Message content must be an object.'
    )
  }

  return conn.sendMessage(
    jid,
    content,
    options || {}
  )
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
      text: String(text ?? ''),
      ...(options.content || {})
    },
    options.send || {}
  )
}

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
      text: String(text ?? ''),
      ...(options.content || {})
    },
    quotedOptions(
      quoted,
      options.send || {}
    )
  )
}


/* ══════════════════════════════════════
   BUTTON NORMALIZER
══════════════════════════════════════ */

export function normalizeButton(button) {
  if (!button)
    return null

  if (Array.isArray(button)) {
    return {
      text: String(button[0] ?? ''),
      id: String(
        button[1] ??
        button[0] ??
        ''
      )
    }
  }

  if (typeof button === 'string') {
    return {
      text: button,
      id: button
    }
  }

  if (typeof button === 'object') {
    return {
      ...button
    }
  }

  return null
}


/* ══════════════════════════════════════
   NATIVE FLOW NORMALIZER
══════════════════════════════════════ */

export function normalizeNativeFlow(flows) {
  if (!Array.isArray(flows))
    return []

  return flows
    .map(flow => {
      if (!flow)
        return null

      if (typeof flow === 'string') {
        return {
          text: flow,
          id: flow
        }
      }

      if (Array.isArray(flow)) {
        return {
          text: String(flow[0] ?? ''),
          id: String(
            flow[1] ??
            flow[0] ??
            ''
          )
        }
      }

      if (typeof flow === 'object') {
        return {
          ...flow
        }
      }

      return null
    })
    .filter(Boolean)
}


/* ══════════════════════════════════════
   BUTTONS
══════════════════════════════════════ */

/*
 * IMPORTANT:
 *
 * @itsliaaa/baileys supports:
 *
 * buttons: [...]
 *
 * and separately:
 *
 * nativeFlow: [...]
 *
 * Do NOT convert buttons into nativeFlow.
 */

export async function sendButtons(
  conn,
  jid,
  {
    text = '',
    footer = '',
    buttons = [],
    image,
    video,
    document,
    audio,
    caption,

    /*
     * Optional native flow.
     * Kept separate from buttons.
     */
    nativeFlow,

    optionText,
    optionTitle,

    ...rest
  } = {},
  quoted,
  options = {}
) {
  const content = {
    ...rest
  }

  /*
   * Regular buttons.
   */
  if (Array.isArray(buttons)) {
    content.buttons = buttons
      .map(normalizeButton)
      .filter(Boolean)
  }

  /*
   * Native Flow.
   */
  if (Array.isArray(nativeFlow)) {
    content.nativeFlow =
      normalizeNativeFlow(nativeFlow)
  }

  /*
   * Media.
   */
  if (image) {
    content.image = image
    content.caption =
      caption ?? text
  } else if (video) {
    content.video = video
    content.caption =
      caption ?? text
  } else if (document) {
    content.document = document
    content.caption =
      caption ?? text
  } else if (audio) {
    content.audio = audio

    /*
     * Audio can still have other fields
     * supplied through rest/content.
     */
  } else {
    content.text = text
  }

  if (footer != null)
    content.footer = footer

  if (optionText != null)
    content.optionText = optionText

  if (optionTitle != null)
    content.optionTitle = optionTitle

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
   LIST
══════════════════════════════════════ */

export function normalizeRow(row) {
  if (!row)
    return null

  if (Array.isArray(row)) {
    return {
      title: String(row[0] ?? ''),
      rowId: String(
        row[1] ??
        row[0] ??
        ''
      ),
      description: String(
        row[2] ?? ''
      )
    }
  }

  if (typeof row !== 'object')
    return null

  return {
    ...row,
    rowId: String(
      row.rowId ??
      row.id ??
      row.title ??
      ''
    )
  }
}

export function normalizeSections(sections) {
  if (!Array.isArray(sections))
    return []

  return sections
    .map(section => {
      if (typeof section === 'string') {
        return {
          title: section,
          rows: []
        }
      }

      if (!section || typeof section !== 'object')
        return null

      return {
        ...section,
        rows: Array.isArray(section.rows)
          ? section.rows
              .map(normalizeRow)
              .filter(Boolean)
          : []
      }
    })
    .filter(Boolean)
}

export async function sendList(
  conn,
  jid,
  {
    text = '',
    title = '',
    footer = '',
    buttonText = 'Select',
    sections = [],
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
      title,
      footer,
      buttonText,
      sections:
        normalizeSections(sections),
      ...rest
    },
    quotedOptions(
      quoted,
      options
    )
  )
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
    audio,

    nativeFlow = [],

    optionText,
    optionTitle,

    offerText,
    offerCode,
    offerUrl,
    offerExpiration,

    interactiveAsTemplate,

    audioFooter,

    ...rest
  } = {},
  quoted,
  options = {}
) {
  const content = {
    ...rest,
    nativeFlow:
      normalizeNativeFlow(
        nativeFlow
      )
  }

  if (image) {
    content.image = image
    content.caption =
      caption ?? text
  } else if (video) {
    content.video = video
    content.caption =
      caption ?? text
  } else if (document) {
    content.document = document
    content.caption =
      caption ?? text
  } else if (audio) {
    content.audio = audio
    content.caption =
      caption ?? text
  } else {
    content.text = text
  }

  if (audioFooter != null)
    content.audioFooter = audioFooter

  if (footer != null)
    content.footer = footer

  if (optionText != null)
    content.optionText = optionText

  if (optionTitle != null)
    content.optionTitle = optionTitle

  if (offerText != null)
    content.offerText = offerText

  if (offerCode != null)
    content.offerCode = offerCode

  if (offerUrl != null)
    content.offerUrl = offerUrl

  if (offerExpiration != null)
    content.offerExpiration =
      offerExpiration

  if (interactiveAsTemplate != null)
    content.interactiveAsTemplate =
      Boolean(interactiveAsTemplate)

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
   CAROUSEL
══════════════════════════════════════ */

function normalizeCard(card) {
  if (!card || typeof card !== 'object')
    return card

  const result = {
    ...card
  }

  if (Array.isArray(card.nativeFlow)) {
    result.nativeFlow =
      normalizeNativeFlow(
        card.nativeFlow
      )
  }

  return result
}

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
  return sendMessage(
    conn,
    jid,
    {
      text,
      footer,
      cards: Array.isArray(cards)
        ? cards
            .map(normalizeCard)
            .filter(Boolean)
        : [],
      ...rest
    },
    quotedOptions(
      quoted,
      options
    )
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
  quoted,
  options = {}
) {
  return sendMessage(
    conn,
    jid,
    {
      image,
      caption,
      ...(options.content || {})
    },
    quotedOptions(
      quoted,
      options.send || {}
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
      ...(options.content || {})
    },
    quotedOptions(
      quoted,
      options.send || {}
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
      ...(options.content || {})
    },
    quotedOptions(
      quoted,
      options.send || {}
    )
  )
}

export async function sendDocument(
  conn,
  jid,
  document,
  mimetype = 'application/octet-stream',
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
      ...(options.content || {})
    },
    quotedOptions(
      quoted,
      options.send || {}
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
      ...(options.content || {})
    },
    quotedOptions(
      quoted,
      options.send || {}
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
  data = {},
  quoted,
  options = {}
) {
  return sendMessage(
    conn,
    jid,
    {
      ...data
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
    name = '',
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
        values: Array.isArray(values)
          ? values
          : [],
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
  name = '',
  number = '',
  organization = '',
  waid
} = {}) {
  const clean = cleanNumber(number)
  const finalWaid =
    cleanNumber(waid) || clean

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${name || clean}`
  ]

  if (organization)
    lines.push(
      `ORG:${organization};`
    )

  lines.push(
    `TEL;type=CELL;type=VOICE;waid=${finalWaid}:+${clean}`,
    'END:VCARD'
  )

  return lines.join('\n')
}

export async function sendContact(
  conn,
  jid,
  {
    displayName = '',
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
        contacts: Array.isArray(contacts)
          ? contacts
          : []
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
  data = {},
  quoted,
  options = {}
) {
  return sendMessage(
    conn,
    jid,
    {
      location: {
        ...data
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

export function extractInviteCode(url) {
  if (!url)
    return null

  const value = String(url).trim()

  const match =
    value.match(
      /(?:https?:\/\/)?(?:www\.)?chat\.whatsapp\.com\/([^/?#\s]+)/i
    )

  return match?.[1] || null
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
    extractInviteCode(inviteUrl)

  if (!code)
    throw new Error(
      'Missing WhatsApp group invite code.'
    )

  return sendMessage(
    conn,
    jid,
    {
      groupInvite: {
        inviteCode: code,
        inviteExpiration:
          inviteExpiration ??
          Date.now() + 86400000,
        text,
        jid: groupJid,
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
  data = {},
  quoted,
  options = {}
) {
  return sendMessage(
    conn,
    jid,
    {
      ...data
    },
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
      richResponse: Array.isArray(richResponse)
        ? richResponse
        : [],
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
   CODE
══════════════════════════════════════ */

export async function sendCode(
  conn,
  jid,
  {
    code = '',
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
      links: Array.isArray(links)
        ? links
        : [],
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
      table: Array.isArray(table)
        ? table
        : [],
      title,
      noHeading: Boolean(noHeading),
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
  if (!key)
    throw new Error(
      'Missing message key.'
    )

  return sendMessage(
    conn,
    jid,
    {
      react: {
        key,
        text: String(text ?? '')
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
  if (!key)
    throw new Error(
      'Missing message key.'
    )

  return sendMessage(
    conn,
    jid,
    {
      pin: key,
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
  if (!key)
    throw new Error(
      'Missing message key.'
    )

  return sendMessage(
    conn,
    jid,
    {
      keep: key,
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
  if (!message)
    throw new Error(
      'Missing message to forward.'
    )

  return sendMessage(
    conn,
    jid,
    {
      forward: message,
      force: Boolean(force)
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
  const paramsJson =
    typeof params === 'string'
      ? params
      : JSON.stringify({
          id,
          description: text,
          ...params
        })

  return sendMessage(
    conn,
    jid,
    {
      flowReply: {
        format,
        text,
        name,
        paramsJson
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
      type: 'template',
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
   DELETE
══════════════════════════════════════ */

export async function deleteMessage(
  conn,
  jid,
  key
) {
  if (!key)
    throw new Error(
      'Missing message key.'
    )

  return sendMessage(
    conn,
    jid,
    {
      delete: key
    }
  )
}


/* ══════════════════════════════════════
   EDIT
══════════════════════════════════════ */

export async function editMessage(
  conn,
  jid,
  key,
  text,
  options = {}
) {
  if (!key)
    throw new Error(
      'Missing message key.'
    )

  return sendMessage(
    conn,
    jid,
    {
      text: String(text ?? ''),
      edit: key,
      ...(options.content || {})
    },
    options.send || {}
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
      text: String(text ?? ''),
      mentionAll: true,
      ...(options.content || {})
    },
    quotedOptions(
      quoted,
      options.send || {}
    )
  )
}


/* ══════════════════════════════════════
   EXTERNAL AD
══════════════════════════════════════ */

export async function sendExternalAd(
  conn,
  jid,
  {
    text = '',
    title = '',
    body = '',

    thumbnail,
    thumbnailUrl,

    mediaUrl,
    mediaType = 1,

    largeThumbnail = false,

    sourceUrl,
    url,

    ...rest
  } = {},
  quoted,
  options = {}
) {
  const externalAdReply = {
    title,
    body,

    mediaType,

    largeThumbnail:
      Boolean(largeThumbnail)
  }

  if (thumbnail != null)
    externalAdReply.thumbnail = thumbnail

  if (thumbnailUrl != null)
    externalAdReply.thumbnailUrl =
      thumbnailUrl

  if (mediaUrl != null)
    externalAdReply.mediaUrl =
      mediaUrl

  if (sourceUrl != null)
    externalAdReply.sourceUrl =
      sourceUrl

  if (url != null)
    externalAdReply.url = url

  return sendMessage(
    conn,
    jid,
    {
      text,
      ...rest,
      externalAdReply
    },
    quotedOptions(
      quoted,
      options
    )
  )
}


/* ══════════════════════════════════════
   ADVANCED
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
      viewOnce: true
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
      viewOnceV2: true
    },
    quotedOptions(
      quoted,
      options
    )
  )
}

export async function sendViewOnceV2Extension(
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
      viewOnceV2Extension: true
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
      spoiler: true
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
      ephemeral: true
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
      groupStatus: true
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
      ...content,
      raw: true
    },
    quotedOptions(
      quoted,
      options
    )
  )
}


/* ══════════════════════════════════════
   INSTALL ON CONN
══════════════════════════════════════ */

export function installWhatsAppHelpers(conn) {
  if (!conn)
    return conn

  if (conn.__ayanaWhatsAppHelpers)
    return conn

  Object.defineProperty(
    conn,
    '__ayanaWhatsAppHelpers',
    {
      value: true,
      enumerable: false,
      configurable: false
    }
  )

  conn.sendText =
    (jid, text, quoted, options = {}) =>
      reply(
        conn,
        jid,
        text,
        quoted,
        options
      )

  conn.sendButton =
    (
      jid,
      text,
      buttons,
      quoted,
      footer = '',
      options = {}
    ) =>
      sendButton(
        conn,
        jid,
        text,
        buttons,
        quoted,
        footer,
        options
      )

  conn.sendButtons =
    (
      jid,
      data,
      quoted,
      options = {}
    ) =>
      sendButtons(
        conn,
        jid,
        data,
        quoted,
        options
      )

  conn.sendList =
    (
      jid,
      data,
      quoted,
      options = {}
    ) =>
      sendList(
        conn,
        jid,
        data,
        quoted,
        options
      )

  conn.sendNativeFlow =
    (
      jid,
      data,
      quoted,
      options = {}
    ) =>
      sendNativeFlow(
        conn,
        jid,
        data,
        quoted,
        options
      )

  conn.sendCarousel =
    (
      jid,
      data,
      quoted,
      options = {}
    ) =>
      sendCarousel(
        conn,
        jid,
        data,
        quoted,
        options
      )

  conn.sendImage =
    (
      jid,
      image,
      caption = '',
      quoted,
      options = {}
    ) =>
      sendImage(
        conn,
        jid,
        image,
        caption,
        quoted,
        options
      )

  conn.sendVideo =
    (
      jid,
      video,
      caption = '',
      quoted,
      options = {}
    ) =>
      sendVideo(
        conn,
        jid,
        video,
        caption,
        quoted,
        options
      )

  conn.sendAudio =
    (
      jid,
      audio,
      ptt = false,
      quoted,
      options = {}
    ) =>
      sendAudio(
        conn,
        jid,
        audio,
        ptt,
        quoted,
        options
      )

  conn.sendDocument =
    (
      jid,
      document,
      mimetype,
      fileName = '',
      caption = '',
      quoted,
      options = {}
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
      )

  conn.sendSticker =
    (
      jid,
      sticker,
      quoted,
      options = {}
    ) =>
      sendSticker(
        conn,
        jid,
        sticker,
        quoted,
        options
      )

  conn.sendAlbum =
    (
      jid,
      album,
      quoted,
      options = {}
    ) =>
      sendAlbum(
        conn,
        jid,
        album,
        quoted,
        options
      )

  conn.sendStickerPack =
    (
      jid,
      data,
      quoted,
      options = {}
    ) =>
      sendStickerPack(
        conn,
        jid,
        data,
        quoted,
        options
      )

  conn.sendPoll =
    (
      jid,
      data,
      quoted,
      options = {}
    ) =>
      sendPoll(
        conn,
        jid,
        data,
        quoted,
        options
      )

  conn.sendPollResult =
    (
      jid,
      result,
      quoted,
      options = {}
    ) =>
      sendPollResult(
        conn,
        jid,
        result,
        quoted,
        options
      )

  conn.sendContact =
    (
      jid,
      data,
      quoted,
      options = {}
    ) =>
      sendContact(
        conn,
        jid,
        data,
        quoted,
        options
      )

  conn.sendLocation =
    (
      jid,
      data,
      quoted,
      options = {}
    ) =>
      sendLocation(
        conn,
        jid,
        data,
        quoted,
        options
      )

  conn.sendEvent =
    (
      jid,
      data,
      quoted,
      options = {}
    ) =>
      sendEvent(
        conn,
        jid,
        data,
        quoted,
        options
      )

  conn.sendGroupInvite =
    (
      jid,
      data,
      quoted,
      options = {}
    ) =>
      sendGroupInvite(
        conn,
        jid,
        data,
        quoted,
        options
      )

  conn.sendProduct =
    (
      jid,
      data,
      quoted,
      options = {}
    ) =>
      sendProduct(
        conn,
        jid,
        data,
        quoted,
        options
      )

  conn.sendRichResponse =
    (
      jid,
      data,
      quoted,
      options = {}
    ) =>
      sendRichResponse(
        conn,
        jid,
        data,
        quoted,
        options
      )

  conn.sendCode =
    (
      jid,
      data,
      quoted,
      options = {}
    ) =>
      sendCode(
        conn,
        jid,
        data,
        quoted,
        options
      )

  conn.sendTable =
    (
      jid,
      data,
      quoted,
      options = {}
    ) =>
      sendTable(
        conn,
        jid,
        data,
        quoted,
        options
      )

  conn.sendInlineEntities =
    (
      jid,
      data,
      quoted,
      options = {}
    ) =>
      sendInlineEntities(
        conn,
        jid,
        data,
        quoted,
        options
      )

  conn.sendButtonResponse =
    (
      jid,
      data,
      quoted,
      options = {}
    ) =>
      sendButtonResponse(
        conn,
        jid,
        data,
        quoted,
        options
      )

  conn.sendListResponse =
    (
      jid,
      data,
      quoted,
      options = {}
    ) =>
      sendListResponse(
        conn,
        jid,
        data,
        quoted,
        options
      )

  conn.sendFlowResponse =
    (
      jid,
      data,
      quoted,
      options = {}
    ) =>
      sendFlowResponse(
        conn,
        jid,
        data,
        quoted,
        options
      )

  conn.sendTemplateResponse =
    (
      jid,
      data,
      quoted,
      options = {}
    ) =>
      sendTemplateResponse(
        conn,
        jid,
        data,
        quoted,
        options
      )

  conn.react =
    (jid, key, text = '') =>
      react(
        conn,
        jid,
        key,
        text
      )

  conn.pinMessage =
    (
      jid,
      key,
      time = 86400,
      type = 1
    ) =>
      pinMessage(
        conn,
        jid,
        key,
        time,
        type
      )

  conn.keepMessage =
    (jid, key, type = 1) =>
      keepMessage(
        conn,
        jid,
        key,
        type
      )

  conn.forwardMessage =
    (
      jid,
      message,
      force = false
    ) =>
      forwardMessage(
        conn,
        jid,
        message,
        force
      )

  conn.deleteMessage =
    (jid, key) =>
      deleteMessage(
        conn,
        jid,
        key
      )

  conn.editMessage =
    (
      jid,
      key,
      text,
      options = {}
    ) =>
      editMessage(
        conn,
        jid,
        key,
        text,
        options
      )

  conn.mentionAll =
    (
      jid,
      text,
      quoted,
      options = {}
    ) =>
      mentionAll(
        conn,
        jid,
        text,
        quoted,
        options
      )

  conn.sendExternalAd =
    (
      jid,
      data,
      quoted,
      options = {}
    ) =>
      sendExternalAd(
        conn,
        jid,
        data,
        quoted,
        options
      )

  conn.sendViewOnce =
    (
      jid,
      content,
      quoted,
      options = {}
    ) =>
      sendViewOnce(
        conn,
        jid,
        content,
        quoted,
        options
      )

  conn.sendViewOnceV2 =
    (
      jid,
      content,
      quoted,
      options = {}
    ) =>
      sendViewOnceV2(
        conn,
        jid,
        content,
        quoted,
        options
      )

  conn.sendViewOnceV2Extension =
    (
      jid,
      content,
      quoted,
      options = {}
    ) =>
      sendViewOnceV2Extension(
        conn,
        jid,
        content,
        quoted,
        options
      )

  conn.sendSpoiler =
    (
      jid,
      content,
      quoted,
      options = {}
    ) =>
      sendSpoiler(
        conn,
        jid,
        content,
        quoted,
        options
      )

  conn.sendEphemeral =
    (
      jid,
      content,
      quoted,
      options = {}
    ) =>
      sendEphemeral(
        conn,
        jid,
        content,
        quoted,
        options
      )

  conn.sendGroupStatus =
    (
      jids,
      content,
      options = {}
    ) =>
      sendGroupStatus(
        conn,
        jids,
        content,
        options
      )

  conn.sendRaw =
    (
      jid,
      content,
      quoted,
      options = {}
    ) =>
      sendRaw(
        conn,
        jid,
        content,
        quoted,
        options
      )

  conn.sendAdvanced =
    (
      jid,
      content,
      quoted,
      options = {}
    ) =>
      sendAdvanced(
        conn,
        jid,
        content,
        quoted,
        options
      )

  conn.sendWithOptions =
    (
      jid,
      content,
      options = {}
    ) =>
      sendWithOptions(
        conn,
        jid,
        content,
        options
      )

  return conn
}


/* ══════════════════════════════════════
   INSTALL ON MESSAGE
══════════════════════════════════════ */

export function installMessageHelpers(m, conn) {
  if (!m || !conn)
    return m

  if (m.__ayanaMessageHelpers)
    return m

  Object.defineProperty(
    m,
    '__ayanaMessageHelpers',
    {
      value: true,
      enumerable: false,
      configurable: false
    }
  )

  m.sendText =
    (text, options = {}) =>
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