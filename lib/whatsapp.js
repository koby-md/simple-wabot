/*
 * lib/whatsapp.js
 * AYANA MD - WhatsApp Helper Layer
 *
 * Compatible with:
 * @whiskeysockets/baileys
 * npm:@itsliaaa/starcore
 *
 * IMPORTANT:
 * - لا نحول @lid بالقوة إلى @s.whatsapp.net
 * - send() يرسل مباشرة إلى conn.sendMessage()
 * - Buttons مدعومة مباشرة من starcore
 * - Native Flow مدعومة مباشرة من starcore
 */

const baileys =
    await import('@whiskeysockets/baileys')


const {
    default: _makeWaSocket,
    makeWALegacySocket,
    proto,
    downloadContentFromMessage,
    jidDecode,
    areJidsSameUser,
    generateForwardMessageContent,
    generateWAMessageFromContent,
    WAMessageStubType,
    extractMessageContent,
    prepareWAMessageMedia,
    jidNormalizedUser
} = baileys


/* ══════════════════════════════════════
   JID
══════════════════════════════════════ */


/**
 * فحص JID
 */
export function isValidJid(jid) {

    return (
        typeof jid === 'string' &&
        jid.length > 3 &&
        jid.includes('@')
    )
}


/**
 * الحصول على JID الحقيقي
 *
 * مهم:
 * @lid يبقى @lid
 */
export function getRealJid(conn, jid) {

    if (!jid)
        return jid

    if (
        typeof jid !== 'string'
    ) {
        return jid
    }


    /*
     * لا نلمس LID
     */
    if (
        jid.includes('@lid')
    ) {

        return (
            jid.split(':')[0] +
            '@lid'
        )
    }


    /*
     * getJid
     */
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


    /*
     * decodeJid
     */
    try {

        if (
            conn &&
            typeof conn.decodeJid === 'function'
        ) {

            const result =
                conn.decodeJid(jid)

            if (result)
                return result
        }

    } catch {}


    /*
     * Baileys
     */
    try {

        return jidNormalizedUser(jid)

    } catch {

        return jid

    }
}


/**
 * مقارنة JIDs
 */
export function sameJid(
    conn,
    a,
    b
) {

    if (!a || !b)
        return false

    if (a === b)
        return true


    /*
     * LID
     */
    if (
        String(a).includes('@lid') ||
        String(b).includes('@lid')
    ) {

        return (
            String(a).split(':')[0] ===
            String(b).split(':')[0]
        )
    }


    try {

        return areJidsSameUser(
            getRealJid(conn, a),
            getRealJid(conn, b)
        )

    } catch {

        return (
            getRealJid(conn, a) ===
            getRealJid(conn, b)
        )
    }
}


/* ══════════════════════════════════════
   CORE SEND
══════════════════════════════════════ */


/**
 * إرسال أساسي
 *
 * IMPORTANT:
 * لا تستخدم getRealJid هنا.
 *
 * السبب:
 * m.chat قد يكون @lid.
 */
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


    if (
        typeof conn.sendMessage !==
        'function'
    ) {

        throw new Error(
            'conn.sendMessage is not available'
        )
    }


    /*
     * إرسال مباشر إلى starcore
     */
    return await conn.sendMessage(
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

        text:
            String(text ?? ''),

        ...extra
    }


    const options = {}


    if (quoted) {

        options.quoted =
            quoted
    }


    return send(
        conn,
        jid,
        content,
        options
    )
}


/* ══════════════════════════════════════
   REPLY
══════════════════════════════════════ */


export async function reply(
    conn,
    m,
    text,
    options = {}
) {

    if (!m)
        throw new Error(
            'Message is missing'
        )


    const jid =
        m.chat ||
        m.key?.remoteJid


    const quoted =
        options.quoted !== undefined
            ? options.quoted
            : m


    return sendText(
        conn,
        jid,
        text,
        quoted,
        options.extra || {}
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

                text:
                    String(
                        emoji ?? ''
                    ),

                key
            }
        }
    )
}


/* ══════════════════════════════════════
   BUTTONS
══════════════════════════════════════ */


/**
 * Buttons العادية
 *
 * starcore يدعم:
 *
 * {
 *   text: 'Hello',
 *   footer: 'Footer',
 *   buttons: [
 *      {
 *          text: 'Button',
 *          id: '#button'
 *      }
 *   ]
 * }
 *
 * حسب التوثيق الرسمي للفورك.
 */
export async function sendButtons(
    conn,
    jid,
    text,
    buttons = [],
    options = {}
) {

    if (!Array.isArray(buttons))
        buttons = []


    const cleanButtons =
        buttons
            .filter(Boolean)
            .map(
                button => {

                    const result = {

                        text:
                            String(
                                button?.text ??
                                ''
                            ),

                        id:
                            String(
                                button?.id ??
                                ''
                            )
                    }


                    /*
                     * بعض interactive
                     * buttons تستخدم sections
                     */
                    if (
                        Array.isArray(
                            button?.sections
                        )
                    ) {

                        result.sections =
                            button.sections
                    }


                    /*
                     * icon
                     */
                    if (
                        button?.icon !==
                        undefined
                    ) {

                        result.icon =
                            String(
                                button.icon
                            )
                    }


                    return result
                }
            )


    if (!cleanButtons.length) {

        throw new Error(
            'No buttons supplied'
        )
    }


    const content = {

        text:
            String(text ?? ''),

        buttons:
            cleanButtons
    }


    /*
     * Footer
     */
    if (
        options.footer !==
        undefined
    ) {

        content.footer =
            String(
                options.footer
            )
    }


    /*
     * Header
     */
    if (
        options.header !==
        undefined
    ) {

        content.header =
            String(
                options.header
            )
    }


    /*
     * Title
     */
    if (
        options.title !==
        undefined
    ) {

        content.title =
            String(
                options.title
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
   NATIVE FLOW
══════════════════════════════════════ */


/**
 * Native Flow
 *
 * starcore يدعم:
 *
 * id
 * call
 * copy
 * url
 * sections
 * icon
 */
export async function sendNativeButtons(
    conn,
    jid,
    text,
    buttons = [],
    options = {}
) {

    if (!Array.isArray(buttons))
        buttons = []


    const nativeFlow =
        buttons
            .filter(Boolean)
            .map(
                button => {

                    const item = {

                        text:
                            String(
                                button?.text ??
                                ''
                            )
                    }


                    /*
                     * Quick Reply
                     */
                    if (
                        button?.id !==
                        undefined
                    ) {

                        item.id =
                            String(
                                button.id
                            )
                    }


                    /*
                     * Call
                     */
                    if (
                        button?.call !==
                        undefined
                    ) {

                        item.call =
                            String(
                                button.call
                            )
                    }


                    /*
                     * Copy
                     */
                    if (
                        button?.copy !==
                        undefined
                    ) {

                        item.copy =
                            String(
                                button.copy
                            )
                    }


                    /*
                     * URL
                     */
                    if (
                        button?.url !==
                        undefined
                    ) {

                        item.url =
                            String(
                                button.url
                            )
                    }


                    /*
                     * Webview
                     */
                    if (
                        button?.useWebview !==
                        undefined
                    ) {

                        item.useWebview =
                            Boolean(
                                button.useWebview
                            )
                    }


                    /*
                     * Sections
                     */
                    if (
                        Array.isArray(
                            button?.sections
                        )
                    ) {

                        item.sections =
                            button.sections
                    }


                    /*
                     * Icon
                     */
                    if (
                        button?.icon !==
                        undefined
                    ) {

                        item.icon =
                            String(
                                button.icon
                            )
                    }


                    return item
                }
            )


    if (!nativeFlow.length) {

        throw new Error(
            'No native buttons supplied'
        )
    }


    const content = {

        text:
            String(text ?? ''),

        nativeFlow
    }


    /*
     * Footer
     */
    if (
        options.footer !==
        undefined
    ) {

        content.footer =
            String(
                options.footer
            )
    }


    /*
     * Option text
     */
    if (
        options.optionText !==
        undefined
    ) {

        content.optionText =
            String(
                options.optionText
            )
    }


    /*
     * Option title
     */
    if (
        options.optionTitle !==
        undefined
    ) {

        content.optionTitle =
            String(
                options.optionTitle
            )
    }


    /*
     * Offer
     */
    if (
        options.offerText !==
        undefined
    ) {

        content.offerText =
            String(
                options.offerText
            )
    }


    if (
        options.offerCode !==
        undefined
    ) {

        content.offerCode =
            String(
                options.offerCode
            )
    }


    if (
        options.offerUrl !==
        undefined
    ) {

        content.offerUrl =
            String(
                options.offerUrl
            )
    }


    if (
        options.offerExpiration !==
        undefined
    ) {

        content.offerExpiration =
            Number(
                options.offerExpiration
            )
    }


    /*
     * Template
     */
    if (
        options.interactiveAsTemplate !==
        undefined
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
            String(
                caption ?? ''
            ),

        nativeFlow:
            Array.isArray(nativeFlow)
                ? nativeFlow
                : []
    }


    if (options.footer) {

        content.footer =
            String(
                options.footer
            )
    }


    if (options.optionText) {

        content.optionText =
            String(
                options.optionText
            )
    }


    if (options.optionTitle) {

        content.optionTitle =
            String(
                options.optionTitle
            )
    }


    if (options.offerText) {

        content.offerText =
            String(
                options.offerText
            )
    }


    if (options.offerCode) {

        content.offerCode =
            String(
                options.offerCode
            )
    }


    if (options.offerUrl) {

        content.offerUrl =
            String(
                options.offerUrl
            )
    }


    if (
        options.offerExpiration !==
        undefined
    ) {

        content.offerExpiration =
            Number(
                options.offerExpiration
            )
    }


    if (
        options.interactiveAsTemplate !==
        undefined
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
   MEDIA BUTTONS
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
            String(
                caption ?? ''
            ),

        buttons:
            Array.isArray(buttons)
                ? buttons
                : []
    }


    if (options.footer) {

        content.footer =
            String(
                options.footer
            )
    }


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
   LIST
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
            String(
                options.title
            )
    }


    if (options.footer) {

        content.footer =
            String(
                options.footer
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
   POLL
══════════════════════════════════════ */


export async function sendPoll(
    conn,
    jid,
    name,
    values = [],
    options = {}
) {

    if (!Array.isArray(values))
        values = []


    const poll = {

        name:
            String(name ?? ''),

        values:
            values.map(
                value =>
                    String(value)
            ),

        selectableCount:
            Number.isInteger(
                options.selectableCount
            )
                ? options.selectableCount
                : 1
    }


    if (
        options.toAnnouncementGroup !==
        undefined
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
        options.hideVoter !==
        undefined
    ) {

        poll.hideVoter =
            Boolean(
                options.hideVoter
            )
    }


    if (
        options.canAddOption !==
        undefined
    ) {

        poll.canAddOption =
            Boolean(
                options.canAddOption
            )
    }


    if (options.correctAnswer) {

        poll.correctAnswer =
            String(
                options.correctAnswer
            )

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
        { poll },
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
                    ? votes.map(
                        vote => ({

                            name:
                                String(
                                    vote?.name ??
                                    ''
                                ),

                            voteCount:
                                Number(
                                    vote?.voteCount ??
                                    0
                                )
                        })
                    )
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
   IMAGE
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
            String(
                caption ?? ''
            ),

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
   VIDEO
══════════════════════════════════════ */


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
            String(
                caption ?? ''
            ),

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
   AUDIO
══════════════════════════════════════ */


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
            Boolean(
                options.ptt
            )
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
   DOCUMENT
══════════════════════════════════════ */


export async function sendDocument(
    conn,
    jid,
    document,
    fileName = 'file',
    mimetype =
        'application/octet-stream',
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
        String(
            phone ?? ''
        ).replace(
            /[^0-9+]/g,
            ''
        )


    const cleanNumber =
        number.replace(
            /\D/g,
            ''
        )


    const vcard =
        [
            'BEGIN:VCARD',
            'VERSION:3.0',
            `FN:${displayName}`,
            `TEL;type=CELL;type=VOICE;waid=${cleanNumber}:${number}`,
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
                    String(
                        displayName
                    ),

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

        if (!m)
            return m


        const q =
            m.quoted


        if (!q)
            return m


        let mime =

            q.mimetype ||

            q.msg?.mimetype ||

            q.message
                ?.imageMessage
                ?.mimetype ||

            q.message
                ?.videoMessage
                ?.mimetype ||

            q.message
                ?.audioMessage
                ?.mimetype ||

            q.message
                ?.documentMessage
                ?.mimetype ||

            q.message
                ?.stickerMessage
                ?.mimetype ||

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

            if (
                q.message?.audioMessage
            ) {

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

                q.message
                    .audioMessage ||

                q.message
                    .videoMessage ||

                q.message
                    .imageMessage ||

                q.message
                    .documentMessage ||

                q.message
                    .stickerMessage ||

                q.message
                    .documentWithCaptionMessage
                    ?.message
                    ?.documentMessage ||

                null
        }


        if (
            typeof q.download !==
                'function' &&

            typeof m.downloadQuoted ===
                'function'
        ) {

            q.download =
                (...args) =>
                    m.downloadQuoted(
                        ...args
                    )
        }


        return m

    } catch {

        return m
    }
}


/* ══════════════════════════════════════
   DOWNLOAD MEDIA
══════════════════════════════════════ */


export async function downloadMedia(
    message,
    type
) {

    if (!message) {

        throw new Error(
            'Message is missing'
        )
    }


    const stream =
        await downloadContentFromMessage(
            message,
            type
        )


    const chunks = []


    for await (
        const chunk of stream
    ) {

        chunks.push(chunk)
    }


    return Buffer.concat(
        chunks
    )
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

            return true
        }

    } catch {}


    return false
}


/* ══════════════════════════════════════
   TYPING
══════════════════════════════════════ */


export async function sendTyping(
    conn,
    jid,
    duration = 2000
) {

    try {

        if (
            typeof conn?.sendPresenceUpdate !==
            'function'
        ) {

            return false
        }


        await conn.sendPresenceUpdate(
            'composing',
            jid
        )


        if (duration > 0) {

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        duration
                    )
            )
        }


        await conn.sendPresenceUpdate(
            'paused',
            jid
        )


        return true

    } catch {

        return false
    }
}


/* ══════════════════════════════════════
   READ
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


        if (!key)
            return false


        await conn.readMessages([
            key
        ])


        return true

    } catch {

        return false
    }
}


/* ══════════════════════════════════════
   GROUP
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
   PARTICIPANTS
══════════════════════════════════════ */


export function findParticipant(
    conn,
    participants = [],
    jid
) {

    if (!Array.isArray(participants))
        return null


    if (!jid)
        return null


    const target =
        getRealJid(
            conn,
            jid
        )


    return (
        participants.find(
            participant => {

                if (!participant)
                    return false


                const id =
                    participant.id ||
                    participant.jid


                const phone =
                    participant.phoneNumber


                return (

                    sameJid(
                        conn,
                        id,
                        target
                    ) ||

                    sameJid(
                        conn,
                        phone,
                        target
                    ) ||

                    id === jid ||

                    phone === jid
                )
            }
        ) ||
        null
    )
}


export function findBotParticipant(
    conn,
    participants = []
) {

    if (!conn)
        return null


    const ids = [

        conn?.user?.id,

        conn?.user?.lid,

        conn?.user?.jid

    ].filter(Boolean)


    for (
        const jid of ids
    ) {

        const participant =
            findParticipant(
                conn,
                participants,
                jid
            )


        if (participant)
            return participant
    }


    return null
}


/* ══════════════════════════════════════
   ADMIN
══════════════════════════════════════ */


export function isAdmin(
    participant
) {

    return (

        participant?.admin ===
            'admin' ||

        participant?.admin ===
            'superadmin'
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
   MESSAGE HELPERS
══════════════════════════════════════ */


export function getMessageContent(
    message
) {

    try {

        return extractMessageContent(
            message
        )

    } catch {

        return message
    }
}


export function decodeJidSafe(
    jid
) {

    try {

        return jidDecode(jid)

    } catch {

        return undefined
    }
}


/* ══════════════════════════════════════
   FORWARD
══════════════════════════════════════ */


export function makeForwardContent(
    message,
    forceForward = false
) {

    try {

        return generateForwardMessageContent(
            message,
            forceForward
        )

    } catch {

        return null
    }
}


/* ══════════════════════════════════════
   GENERATE MESSAGE
══════════════════════════════════════ */


export function generateMessage(
    jid,
    content,
    options = {}
) {

    try {

        return generateWAMessageFromContent(
            jid,
            content,
            options
        )

    } catch {

        return null
    }
}


/* ══════════════════════════════════════
   PREPARE MEDIA
══════════════════════════════════════ */


export async function prepareMedia(
    conn,
    media,
    options = {}
) {

    try {

        return await prepareWAMessageMedia(
            media,
            {
                upload:
                    options.upload ||
                    conn?.waUploadToServer,

                ...options
            }
        )

    } catch {

        return null
    }
}


/* ══════════════════════════════════════
   SOCKET
══════════════════════════════════════ */


export function makeWASocket(
    options = {}
) {

    if (
        typeof _makeWaSocket ===
        'function'
    ) {

        return _makeWaSocket(
            options
        )
    }


    if (
        typeof makeWALegacySocket ===
        'function'
    ) {

        return makeWALegacySocket(
            options
        )
    }


    throw new Error(
        'Baileys makeWASocket is not available'
    )
}


/* ══════════════════════════════════════
   DEFAULT EXPORT
══════════════════════════════════════ */


export default {

    /*
     * Baileys
     */

    baileys,

    _makeWaSocket,

    makeWASocket,

    makeWALegacySocket,

    proto,

    downloadContentFromMessage,

    jidDecode,

    areJidsSameUser,

    generateForwardMessageContent,

    generateWAMessageFromContent,

    WAMessageStubType,

    extractMessageContent,

    prepareWAMessageMedia,

    jidNormalizedUser,


    /*
     * JID
     */

    isValidJid,

    getRealJid,

    sameJid,


    /*
     * Sending
     */

    send,

    reply,

    sendText,

    sendReaction,

    sendButtons,

    sendNativeButtons,

    sendNativeFlow,

    sendNativeFlowImage,

    sendMediaButtons,

    sendList,

    sendPoll,

    sendPollResult,


    /*
     * Media
     */

    sendImage,

    sendVideo,

    sendAudio,

    sendDocument,

    sendSticker,

    sendLocation,

    sendContact,

    downloadMedia,


    /*
     * Messages
     */

    normalizeQuoted,

    getMessageContent,

    decodeJidSafe,

    makeForwardContent,

    generateMessage,

    prepareMedia,


    /*
     * Presence
     */

    keepOnline,

    sendTyping,

    markRead,


    /*
     * Groups
     */

    getGroupMetadata,

    findParticipant,

    findBotParticipant,


    /*
     * Admin
     */

    isAdmin,

    isSuperAdmin,

    isBotAdmin

}