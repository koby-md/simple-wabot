import fetch from 'node-fetch';

let handler = async (m, { conn, args }) => {
  if (!args[0]) throw 'أرسل رابط فيديو يوتيوب!\nمثال: .ytmp4 https://youtu.be/EH3EouP3_EQ';

  try {
    let url = args[0];
    let api = `https://www.velyn.biz.id/api/downloader/ytmp4?url=${encodeURIComponent(url)}`;
    let res = await fetch(api);
    let json = await res.json();

    if (!json.status || !json.data?.status) throw 'فشل في جلب الفيديو، تأكد من الرابط!';

    let { title, url: videoUrl } = json.data;

    if (!videoUrl) throw 'لم يتم العثور على رابط التحميل.';

    await conn.sendMessage(m.chat, {
      video: { url: videoUrl },
      caption: `🎥 *${title}*`,
    }, { quoted: m });

  } catch (e) {
    console.error(e);
    m.reply('حدث خطأ أثناء معالجة الطلب.');
  }
};

handler.help = ['ytv <رابط>'];
handler.tags = ['downloader'];
handler.command = /^ytv$/i;
handler.limit = false;

export default handler;