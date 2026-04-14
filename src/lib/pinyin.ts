// 将中文昵称转为拼音作为默认密码
import pinyinLib from 'pinyin'

/**
 * 昵称 → 拼音密码（全小写，无空格，无声调）
 * 例：'小明' → 'xiaoming'
 */
export function nicknameToPinyin(nickname: string): string {
  const result = pinyinLib(nickname, {
    style: pinyinLib.STYLE_NORMAL,  // 无声调
    heteronym: false,               // 取第一个发音
    segment: true,                  // 启用分词（更准确）
  })
  // pinyin 返回 string[][]，展平拼接
  return result.flat().join('')
}
