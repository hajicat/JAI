// 将中文昵称转为拼音作为默认密码
import pinyinLib from 'pinyin'

/**
 * 昵称 → 拼音密码（全小写，无空格，无声调，最少8位）
 * 不足8位时尾部补 "123" 循环追加直到达标
 * 例：
 *   '小明'   → 'xiaoming'   (刚好8位，不补)
 *   '阿强'   → 'aqiang123'  (6位+补2位到8)
 *   'Tom'    → 'tom12345'   (3位+补5位到8)
 *   'Alice'  → 'alice123'   (5位+补3位到8)
 */
export function nicknameToPinyin(nickname: string): string {
  const result = pinyinLib(nickname, {
    style: pinyinLib.STYLE_NORMAL,  // 无声调
    heteronym: false,               // 取第一个发音
    segment: true,                  // 启用分词（更准确）
  })
  const base = result.flat().join('') // 拼音/英文字母原样输出
  if (base.length >= 8) return base
  // 不足8位：循环补 "123"
  const suffix = '123'
  let padded = base
  let i = 0
  while (padded.length < 8) {
    padded += suffix[i % suffix.length]
    i++
  }
  return padded
}
