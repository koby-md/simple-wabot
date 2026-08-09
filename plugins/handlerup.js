import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const HANDLER_PATH = path.resolve(__dirname, '../handler.js')
const BACKUP_PATH = path.resolve(__dirname, '../handler.js.backup')

function cleanCode(code) {
  if (!code) return ''

  code = String(code).trim()

  // إزالة ```js أو ```javascript من البداية
  code = code.replace(
    /^```(?:js|javascript|jsx|mjs)?\s*/i,
    ''
  )

  // إزالة ``` من النهاية
  code = code.replace(
    /\s*```$/i,
    ''
  )

  return code.trim()
}

async function getQuotedText(m) {

  if (!m.quoted) return null

  // serialize.js
  if (
    typeof m.quoted.text === 'string' &&
    m.quoted.text.trim()
  ) {
    return m.quoted.text
  }

  // conversation
  if (
    typeof m.quoted.message?.conversation === 'string'
  ) {
    return m.quoted.message.conversation
  }

  // extendedTextMessage
  if (
    typeof m.quoted.message
      ?.extendedTextMessage?.text === 'string'
  ) {
    return m.quoted.message.extendedTextMessage.text
  }

  // ephemeral
  const ephemeral =
    m.quoted.message
      ?.ephemeralMessage
      ?.message

  if (ephemeral) {

    if (
      typeof ephemeral.conversation === 'string'
    ) {
      return ephemeral.conversation
    }

    if (
      typeof ephemeral
        .extendedTextMessage?.text === 'string'
    ) {
      return ephemeral.extendedTextMessage.text
    }
  }

  // view once
  const viewOnce =
    m.quoted.message
      ?.viewOnceMessage
      ?.message

  if (viewOnce) {

    if (
      typeof viewOnce.conversation === 'string'
    ) {
      return viewOnce.conversation
    }

    if (
      typeof viewOnce
        .extendedTextMessage?.text === 'string'
    ) {
      return viewOnce.extendedTextMessage.text
    }
  }

  return null
}

let handler = async (
  m,
  {
    conn,
    isOwner,
    isROwner
  }
) => {

  // ==========================================
  // OWNER ONLY
  // ==========================================

  if (!isOwner && !isROwner) {
    return m.reply(
      '❌ هذا الأمر خاص بالـ Owner فقط.'
    )
  }

  // ==========================================
  // يجب أن يكون Reply
  // ==========================================

  if (!m.quoted) {
    return m.reply(
      '❌ يجب أن تعمل Reply على الرسالة التي تحتوي على كود handler.js.\n\n' +
      'ثم اكتب:\n' +
      '.handlerup'
    )
  }

  // ==========================================
  // استخراج الكود من الرسالة المقتبسة
  // ==========================================

  let code

  try {

    code = await getQuotedText(m)

  } catch (e) {

    console.error(
      '[HANDLERUP] Quote Error:',
      e
    )

    return m.reply(
      '❌ حدث خطأ أثناء قراءة الرسالة المقتبسة.\n\n' +
      String(e)
    )
  }

  if (!code) {

    return m.reply(
      '❌ الرسالة المقتبسة لا تحتوي على نص.\n\n' +
      'أرسل كود handler.js كنص، ثم اعمل Reply عليه واكتب:\n' +
      '.handlerup'
    )
  }

  // ==========================================
  // تنظيف Markdown
  // ==========================================

  code = cleanCode(code)

  if (!code) {
    return m.reply(
      '❌ الكود المقتبس فارغ.'
    )
  }

  // ==========================================
  // حماية
  // ==========================================

  if (code.length < 500) {

    return m.reply(
      '❌ الكود قصير جداً.\n\n' +
      `📏 الحجم: ${code.length} حرف\n\n` +
      'تأكد أنك أرسلت handler.js كاملاً.'
    )
  }

  // ==========================================
  // رسالة الفحص
  // ==========================================

  await m.reply(
    '⏳ جاري قراءة كود handler.js من الرسالة المقتبسة...\n\n' +
    '🔎 جاري فحص Syntax...\n' +
    '⚠️ لن يتم تغيير الملف إذا كان الكود غير صالح.'
  )

  /*
   * مهم جداً:
   *
   * سابقاً كان الاسم:
   *
   * handler.js.tmp-123
   *
   * وهذا يجعل Node يعتبر الامتداد:
   *
   * .tmp-123
   *
   * لذلك نضع .js في النهاية:
   *
   * handler.tmp-123.js
   */

  const tempPath = path.resolve(
    __dirname,
    `../handler.tmp-${Date.now()}.js`
  )

  try {

    // ==========================================
    // إنشاء الملف المؤقت
    // ==========================================

    fs.writeFileSync(
      tempPath,
      code,
      'utf8'
    )

    // ==========================================
    // فحص Syntax
    // ==========================================

    const check = spawnSync(
      process.execPath,
      [
        '--check',
        tempPath
      ],
      {
        encoding: 'utf8'
      }
    )

    if (check.error) {

      throw new Error(
        'تعذر تشغيل Node.js لفحص الكود:\n' +
        check.error.message
      )
    }

    if (check.status !== 0) {

      const output = String(
        check.stderr ||
        check.stdout ||
        'Unknown SyntaxError'
      ).trim()

      throw new Error(
        'SyntaxError في handler.js الجديد:\n\n' +
        output
      )
    }

    // ==========================================
    // Backup
    // ==========================================

    if (fs.existsSync(HANDLER_PATH)) {

      fs.copyFileSync(
        HANDLER_PATH,
        BACKUP_PATH
      )
    }

    // ==========================================
    // استبدال handler.js
    // ==========================================

    fs.copyFileSync(
      tempPath,
      HANDLER_PATH
    )

    // ==========================================
    // حذف المؤقت
    // ==========================================

    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath)
    }

    // ==========================================
    // نجاح
    // ==========================================

    await m.reply(
      '✅ تم تحديث handler.js بنجاح!\n\n' +
      `📦 حجم الكود: ${code.length} حرف\n` +
      '💾 تم إنشاء نسخة احتياطية:\n' +
      'handler.js.backup\n\n' +
      '🔄 سيتم إعادة تشغيل البوت الآن...'
    )

    // إعطاء WhatsApp فرصة لإرسال الرسالة
    await new Promise(
      resolve => setTimeout(resolve, 2500)
    )

    // ==========================================
    // Restart
    // ==========================================

    process.exit(0)

  } catch (error) {

    // ==========================================
    // حذف الملف المؤقت
    // ==========================================

    try {

      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath)
      }

    } catch {}

    console.error(
      '[HANDLERUP ERROR]',
      error
    )

    let errorText =
      error?.message ||
      String(error)

    if (errorText.length > 3500) {

      errorText =
        errorText.slice(0, 3500) +
        '\n...'
    }

    // ==========================================
    // لا يتم لمس handler.js
    // ==========================================

    await m.reply(
      '❌ فشل تحديث handler.js.\n\n' +
      '🛡️ الملف القديم لم يتم تغييره.\n\n' +
      'سبب الخطأ:\n\n' +
      '```text\n' +
      errorText +
      '\n```'
    )
  }
}

handler.help = ['handlerup']
handler.tags = ['owner']
handler.command = /^ha$/i
handler.owner = true

export default handler