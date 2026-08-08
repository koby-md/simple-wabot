import translate from 'translate-google-api';
import { generateWAMessageFromContent } from '@whiskeysockets/baileys';

const handler = async (m, { conn, args, usedPrefix, command }) => {
  // جمع كافة الكلمات بعد الأمر
  let fullText = args.join(' ').trim();

  // دعم الترجمة في حالة الرد على رسالة (Quoted)
  if (!fullText && m.quoted && m.quoted.text) {
    fullText = m.quoted.text;
  }

  // إذا لم يكتب المستخدم أي نص
  if (!fullText) {
    return m.reply(`*🧶هذا للترجمة*\n\nيرجى كتابة النص المراد ترجمته🧶.\n*مثال:* ${usedPrefix + command} hello🧶`);
  }

  // التحقق مما إذا كانت الكلمة الأولى عبارة عن رمز لغة من حرفين (مثل ar, en, fr)
  const firstWord = args[0] ? args[0].toLowerCase() : '';
  const isLangCode = firstWord.length === 2;

  // === الحالة الأولى: تم تحديد اللغة (مثل .tr en hello أو عند الضغط على الزر) ===
  if (isLangCode && args.length > 1) {
    const targetLang = firstWord;
    const textToTranslate = args.slice(1).join(' ');

    try {
      await m.react('⏳');
      
      // الاستدعاء الخاص بمكتبة translate-google-api
      const result = await translate(textToTranslate, { to: targetLang });
      
      // استخراج النص المترجم (المكتبة ترجع النتيجة كمصفوفة في الغالب)
      const translatedText = Array.isArray(result) ? result[0] : result;
      
      await m.reply(translatedText);
      await m.react('✅');
    } catch (error) {
      console.error('Translation Error:', error);
      await m.reply('❌ حدث خطأ أثناء الترجمة. يرجى التأكد من أن رمز اللغة صحيح.');
    }

  // === الحالة الثانية: لم يتم تحديد اللغة (مثل .tr hello) -> إظهار الأزرار ===
  } else {
    const textToTranslate = fullText;

    try {
      const msg = generateWAMessageFromContent(
        m.chat,
        {
          viewOnceMessage: {
            message: {
              interactiveMessage: {
                body: {
                  text: `📝 *🧶النص المراد ترجمته:🧶*\n"${textToTranslate}"\n\nإختر اللغة التي تريد الترجمة إليها من الأزرار أسفله:`
                },
                footer: {
                  text: 'بوت الترجمة 🌐'
                },
                nativeFlowMessage: {
                  buttons: [
                    {
                      name: 'quick_reply',
                      buttonParamsJson: JSON.stringify({
                        display_text: '🇲🇦 العربية',
                        id: `${usedPrefix + command} ar ${textToTranslate}`
                      })
                    },
                    {
                      name: 'quick_reply',
                      buttonParamsJson: JSON.stringify({
                        display_text: '🇬🇧 الإنجليزية',
                        id: `${usedPrefix + command} en ${textToTranslate}`
                      })
                    },
                    {
                      name: 'quick_reply',
                      buttonParamsJson: JSON.stringify({
                        display_text: '🇫🇷 الفرنسية',
                        id: `${usedPrefix + command} fr ${textToTranslate}`
                      })
                    }
                  ]
                }
              }
            }
          }
        },
        {
          userJid: conn.user.jid,
          quoted: m
        }
      );

      await conn.relayMessage(
        m.chat,
        msg.message,
        { messageId: msg.key.id }
      );

    } catch (e) {
      console.error(e);
      m.reply('❌ فشل إرسال أزرار الترجمة');
    }
  }
};

handler.command = ['tr'];
handler.tags = ['tools'];

export default handler;