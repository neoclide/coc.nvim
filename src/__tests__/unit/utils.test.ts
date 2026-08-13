import { spawn } from 'child_process'
import { NotificationType, NotificationType1, RequestType, RequestType1 } from 'vscode-languageserver-protocol'
import { checkProcessDied, handleChildProcessStartError } from '../../language-client/index'
import { data2String, fixNotificationType, fixRequestType, getLocale, getParameterStructures, getTracePrefix, isValidNotificationType, isValidRequestType, parseTraceData } from '../../language-client/utils'
import { Delayer } from '../../language-client/utils/async'
import { CloseAction, DefaultErrorHandler, ErrorAction, toCloseHandlerResult } from '../../language-client/utils/errorHandler'
import { ConsoleLogger, NullLogger } from '../../language-client/utils/logger'
import { wait } from '../../util/index'
import * as charCodes from '../../util/charCode'
import { test } from 'node:test'

const nullChannel = {
  content: '',
  show: () => {},
  dispose: () => {},
  name: 'null',
  append: () => {},
  appendLine: () => {},
  clear: () => {},
  hide: () => {}
}

test('Logger', () => {
  const logger = new ConsoleLogger()
  logger.error('error')
  logger.warn('warn')
  logger.info('info')
  logger.log('log')
  const nullLogger = new NullLogger()
  nullLogger.error('error')
  nullLogger.warn('warn')
  nullLogger.info('info')
  nullLogger.log('log')
})

test('checkProcessDied', async () => {
  checkProcessDied(undefined)
  let child = spawn('sleep', ['3'], { cwd: process.cwd(), detached: true })
  checkProcessDied(child)
  await wait(20)
  await assert.rejects(async () => {
    await handleChildProcessStartError(null, 'msg')
  })
})

test('getLocale', () => {
  process.env.LANG = ''
  assert.strictEqual(getLocale(), 'en')
  process.env.LANG = 'en_US.UTF-8'
  assert.strictEqual(getLocale(), 'en_US')
})

test('getTraceMessage', () => {
  assert.match(getTracePrefix({}), /Trace/)
  assert.match(getTracePrefix({ isLSPMessage: true, type: 'request' }), /LSP/)
})

test('getParameterStructures', () => {
  assert.strictEqual(getParameterStructures('auto').toString(), 'auto')
  // test all the cased of getParameterStructures
  assert.strictEqual(getParameterStructures('byPosition').toString(), 'byPosition')
  assert.strictEqual(getParameterStructures('byName').toString(), 'byName')
  assert.strictEqual(getParameterStructures('unknown').toString(), 'auto')
})

test('isValidRequestType', () => {
  assert.strictEqual(isValidRequestType('test'), true)
  assert.strictEqual(isValidRequestType({ method: 'test' }), false)
  assert.strictEqual(isValidRequestType(new RequestType('test')), true)
})

test('isValidNotificationType', () => {
  assert.strictEqual(isValidNotificationType('test'), true)
  assert.strictEqual(isValidNotificationType({ method: 'test' }), false)
  assert.strictEqual(isValidNotificationType(new NotificationType('test')), true)
})

test('fixRequestType', () => {
  assert.strictEqual(fixRequestType('test', []), 'test')
  for (let i = 0; i <= 10; i++) {
    let type = { method: 'test', numberOfParams: i }
    assert.notStrictEqual(fixRequestType(type, []), undefined)
  }
  let type = { method: 'test', numberOfParams: 1, parameterStructures: 'auto' }
  let res = fixRequestType(type, []) as RequestType1<unknown, undefined, undefined>
  assert.strictEqual(res.numberOfParams, 1)
  assert.notStrictEqual(res.parameterStructures, undefined)
})

test('fixNotificationType', () => {
  assert.strictEqual(fixNotificationType('test', []), 'test')
  for (let i = 0; i <= 10; i++) {
    let type = { method: 'test', numberOfParams: i }
    assert.notStrictEqual(fixNotificationType(type, []), undefined)
  }
  let type = { method: 'test', numberOfParams: 1, parameterStructures: 'auto' }
  let res = fixNotificationType(type, []) as NotificationType1<unknown>
  assert.strictEqual(res.numberOfParams, 1)
  assert.notStrictEqual(res.parameterStructures, undefined)
})

test('data2String', () => {
  let err = new Error('my error')
  err.stack = undefined
  let text = data2String(err)
  assert.match(text, /error/)
})

test('parseTraceData', () => {
  assert.strictEqual(parseTraceData({}), '{}')
  assert.match(parseTraceData('msg'), /msg/)
  assert.match(parseTraceData('Params: data'), /data/)
  assert.match(parseTraceData('Result: {"foo": "bar"}'), /bar/)
})

test('DefaultErrorHandler', async t => {
  t.mock.method(console, 'error', () => {
    // ignore
  })
  let handler = new DefaultErrorHandler('test', 2)
  assert.strictEqual(handler.error(new Error('test'), { jsonrpc: '' }, 1).action, ErrorAction.Continue)
  assert.strictEqual(handler.error(new Error('test'), { jsonrpc: '' }, 5).action, ErrorAction.Shutdown)
  handler.closed()
  handler.milliseconds = 1
  await wait(20)
  let res = handler.closed()
  assert.strictEqual(res.action, CloseAction.Restart)
  handler.milliseconds = 10 * 1000
  res = handler.closed()
  assert.strictEqual(res.action, CloseAction.DoNotRestart)
  assert.notStrictEqual(toCloseHandlerResult(CloseAction.DoNotRestart), undefined)
  handler = new DefaultErrorHandler('test', 1, nullChannel as any)
  handler.closed()
})

test('DefaultErrorHandler restart budget', () => {
  let handler = new DefaultErrorHandler('test', 2)
  handler.milliseconds = 60 * 1000
  // Crashes within the restart budget keep restarting.
  assert.strictEqual(handler.closed().action, CloseAction.Restart)
  assert.strictEqual(handler.closed().action, CloseAction.Restart)
  // The crash after the budget reports the actual number of crashes.
  let res = handler.closed()
  assert.strictEqual(res.action, CloseAction.DoNotRestart)
  assert.ok(res.message.includes('crashed 3 times'))
})

test('DefaultErrorHandler reports crashes through output channel', () => {
  let appended = ''
  let handler = new DefaultErrorHandler('test', 1, {
    appendLine: (value: string) => {
      appended = value
    }
  } as any)
  handler.milliseconds = 60 * 1000
  handler.closed()
  let res = handler.closed()
  assert.strictEqual(res.action, CloseAction.DoNotRestart)
  assert.match(appended, /server crashed 2 times/)
})

test('DefaultErrorHandler restarts after the crash budget window', async () => {
  let handler = new DefaultErrorHandler('test', 1)
  handler.closed()
  handler.milliseconds = 1
  await wait(20)
  let res = handler.closed()
  assert.strictEqual(res.action, CloseAction.Restart)
})

test('Delayer', () => {
  let count = 0
  let factory = () => {
    return Promise.resolve(++count)
  }

  let delayer = new Delayer(0)
  let promises: Thenable<any>[] = []

  assert(!delayer.isTriggered())
  void delayer.trigger(factory, -1)

  promises.push(delayer.trigger(factory).then((result) => { assert.equal(result, 1); assert(!delayer.isTriggered()) }))
  assert(delayer.isTriggered())

  promises.push(delayer.trigger(factory).then((result) => { assert.equal(result, 1); assert(!delayer.isTriggered()) }))
  assert(delayer.isTriggered())

  promises.push(delayer.trigger(factory).then((result) => { assert.equal(result, 1); assert(!delayer.isTriggered()) }))
  assert(delayer.isTriggered())

  return Promise.all(promises).then(() => {
    assert(!delayer.isTriggered())
  }).finally(() => {
    delayer.dispose()
  })
})

test('Delayer - forceDelivery', async () => {
  let count = 0
  let factory = () => {
    return Promise.resolve(++count)
  }

  let delayer = new Delayer(150)
  delayer.forceDelivery()
  void delayer.trigger(factory).then((result) => { assert.equal(result, 1); assert(!delayer.isTriggered()) })
  await wait(20)
  delayer.forceDelivery()
  assert.strictEqual(count, 1)
  void delayer.trigger(factory)
  void delayer.trigger(factory, -1)
  await wait(20)
  delayer.cancel()
  assert.strictEqual(count, 1)
})

test('Delayer - last task should be the one getting called', function() {
  let factoryFactory = (n: number) => () => {
    return Promise.resolve(n)
  }

  let delayer = new Delayer(0)
  let promises: Thenable<any>[] = []

  assert(!delayer.isTriggered())

  promises.push(delayer.trigger(factoryFactory(1)).then((n) => { assert.equal(n, 3) }))
  promises.push(delayer.trigger(factoryFactory(2)).then((n) => { assert.equal(n, 3) }))
  promises.push(delayer.trigger(factoryFactory(3)).then((n) => { assert.equal(n, 3) }))

  const p = Promise.all(promises).then(() => {
    assert(!delayer.isTriggered())
  })

  assert(delayer.isTriggered())

  return p
})

test('CharCode', () => {
  const expected: Record<string, number> = {
  'Null': 0,
  'Backspace': 8,
  'Tab': 9,
  'LineFeed': 10,
  'CarriageReturn': 13,
  'Space': 32,
  'ExclamationMark': 33,
  'DoubleQuote': 34,
  'Hash': 35,
  'DollarSign': 36,
  'PercentSign': 37,
  'Ampersand': 38,
  'SingleQuote': 39,
  'OpenParen': 40,
  'CloseParen': 41,
  'Asterisk': 42,
  'Plus': 43,
  'Comma': 44,
  'Dash': 45,
  'Period': 46,
  'Slash': 47,
  'Digit0': 48,
  'Digit1': 49,
  'Digit2': 50,
  'Digit3': 51,
  'Digit4': 52,
  'Digit5': 53,
  'Digit6': 54,
  'Digit7': 55,
  'Digit8': 56,
  'Digit9': 57,
  'Colon': 58,
  'Semicolon': 59,
  'LessThan': 60,
  'Equals': 61,
  'GreaterThan': 62,
  'QuestionMark': 63,
  'AtSign': 64,
  'A': 65,
  'B': 66,
  'C': 67,
  'D': 68,
  'E': 69,
  'F': 70,
  'G': 71,
  'H': 72,
  'I': 73,
  'J': 74,
  'K': 75,
  'L': 76,
  'M': 77,
  'N': 78,
  'O': 79,
  'P': 80,
  'Q': 81,
  'R': 82,
  'S': 83,
  'T': 84,
  'U': 85,
  'V': 86,
  'W': 87,
  'X': 88,
  'Y': 89,
  'Z': 90,
  'OpenSquareBracket': 91,
  'Backslash': 92,
  'CloseSquareBracket': 93,
  'Caret': 94,
  'Underline': 95,
  'BackTick': 96,
  'a': 97,
  'b': 98,
  'c': 99,
  'd': 100,
  'e': 101,
  'f': 102,
  'g': 103,
  'h': 104,
  'i': 105,
  'j': 106,
  'k': 107,
  'l': 108,
  'm': 109,
  'n': 110,
  'o': 111,
  'p': 112,
  'q': 113,
  'r': 114,
  's': 115,
  't': 116,
  'u': 117,
  'v': 118,
  'w': 119,
  'x': 120,
  'y': 121,
  'z': 122,
  'OpenCurlyBrace': 123,
  'Pipe': 124,
  'CloseCurlyBrace': 125,
  'Tilde': 126,
  'U_Combining_Grave_Accent': 0x0300,
  'U_Combining_Acute_Accent': 0x0301,
  'U_Combining_Circumflex_Accent': 0x0302,
  'U_Combining_Tilde': 0x0303,
  'U_Combining_Macron': 0x0304,
  'U_Combining_Overline': 0x0305,
  'U_Combining_Breve': 0x0306,
  'U_Combining_Dot_Above': 0x0307,
  'U_Combining_Diaeresis': 0x0308,
  'U_Combining_Hook_Above': 0x0309,
  'U_Combining_Ring_Above': 0x030A,
  'U_Combining_Double_Acute_Accent': 0x030B,
  'U_Combining_Caron': 0x030C,
  'U_Combining_Vertical_Line_Above': 0x030D,
  'U_Combining_Double_Vertical_Line_Above': 0x030E,
  'U_Combining_Double_Grave_Accent': 0x030F,
  'U_Combining_Candrabindu': 0x0310,
  'U_Combining_Inverted_Breve': 0x0311,
  'U_Combining_Turned_Comma_Above': 0x0312,
  'U_Combining_Comma_Above': 0x0313,
  'U_Combining_Reversed_Comma_Above': 0x0314,
  'U_Combining_Comma_Above_Right': 0x0315,
  'U_Combining_Grave_Accent_Below': 0x0316,
  'U_Combining_Acute_Accent_Below': 0x0317,
  'U_Combining_Left_Tack_Below': 0x0318,
  'U_Combining_Right_Tack_Below': 0x0319,
  'U_Combining_Left_Angle_Above': 0x031A,
  'U_Combining_Horn': 0x031B,
  'U_Combining_Left_Half_Ring_Below': 0x031C,
  'U_Combining_Up_Tack_Below': 0x031D,
  'U_Combining_Down_Tack_Below': 0x031E,
  'U_Combining_Plus_Sign_Below': 0x031F,
  'U_Combining_Minus_Sign_Below': 0x0320,
  'U_Combining_Palatalized_Hook_Below': 0x0321,
  'U_Combining_Retroflex_Hook_Below': 0x0322,
  'U_Combining_Dot_Below': 0x0323,
  'U_Combining_Diaeresis_Below': 0x0324,
  'U_Combining_Ring_Below': 0x0325,
  'U_Combining_Comma_Below': 0x0326,
  'U_Combining_Cedilla': 0x0327,
  'U_Combining_Ogonek': 0x0328,
  'U_Combining_Vertical_Line_Below': 0x0329,
  'U_Combining_Bridge_Below': 0x032A,
  'U_Combining_Inverted_Double_Arch_Below': 0x032B,
  'U_Combining_Caron_Below': 0x032C,
  'U_Combining_Circumflex_Accent_Below': 0x032D,
  'U_Combining_Breve_Below': 0x032E,
  'U_Combining_Inverted_Breve_Below': 0x032F,
  'U_Combining_Tilde_Below': 0x0330,
  'U_Combining_Macron_Below': 0x0331,
  'U_Combining_Low_Line': 0x0332,
  'U_Combining_Double_Low_Line': 0x0333,
  'U_Combining_Tilde_Overlay': 0x0334,
  'U_Combining_Short_Stroke_Overlay': 0x0335,
  'U_Combining_Long_Stroke_Overlay': 0x0336,
  'U_Combining_Short_Solidus_Overlay': 0x0337,
  'U_Combining_Long_Solidus_Overlay': 0x0338,
  'U_Combining_Right_Half_Ring_Below': 0x0339,
  'U_Combining_Inverted_Bridge_Below': 0x033A,
  'U_Combining_Square_Below': 0x033B,
  'U_Combining_Seagull_Below': 0x033C,
  'U_Combining_X_Above': 0x033D,
  'U_Combining_Vertical_Tilde': 0x033E,
  'U_Combining_Double_Overline': 0x033F,
  'U_Combining_Grave_Tone_Mark': 0x0340,
  'U_Combining_Acute_Tone_Mark': 0x0341,
  'U_Combining_Greek_Perispomeni': 0x0342,
  'U_Combining_Greek_Koronis': 0x0343,
  'U_Combining_Greek_Dialytika_Tonos': 0x0344,
  'U_Combining_Greek_Ypogegrammeni': 0x0345,
  'U_Combining_Bridge_Above': 0x0346,
  'U_Combining_Equals_Sign_Below': 0x0347,
  'U_Combining_Double_Vertical_Line_Below': 0x0348,
  'U_Combining_Left_Angle_Below': 0x0349,
  'U_Combining_Not_Tilde_Above': 0x034A,
  'U_Combining_Homothetic_Above': 0x034B,
  'U_Combining_Almost_Equal_To_Above': 0x034C,
  'U_Combining_Left_Right_Arrow_Below': 0x034D,
  'U_Combining_Upwards_Arrow_Below': 0x034E,
  'U_Combining_Grapheme_Joiner': 0x034F,
  'U_Combining_Right_Arrowhead_Above': 0x0350,
  'U_Combining_Left_Half_Ring_Above': 0x0351,
  'U_Combining_Fermata': 0x0352,
  'U_Combining_X_Below': 0x0353,
  'U_Combining_Left_Arrowhead_Below': 0x0354,
  'U_Combining_Right_Arrowhead_Below': 0x0355,
  'U_Combining_Right_Arrowhead_And_Up_Arrowhead_Below': 0x0356,
  'U_Combining_Right_Half_Ring_Above': 0x0357,
  'U_Combining_Dot_Above_Right': 0x0358,
  'U_Combining_Asterisk_Below': 0x0359,
  'U_Combining_Double_Ring_Below': 0x035A,
  'U_Combining_Zigzag_Above': 0x035B,
  'U_Combining_Double_Breve_Below': 0x035C,
  'U_Combining_Double_Breve': 0x035D,
  'U_Combining_Double_Macron': 0x035E,
  'U_Combining_Double_Macron_Below': 0x035F,
  'U_Combining_Double_Tilde': 0x0360,
  'U_Combining_Double_Inverted_Breve': 0x0361,
  'U_Combining_Double_Rightwards_Arrow_Below': 0x0362,
  'U_Combining_Latin_Small_Letter_A': 0x0363,
  'U_Combining_Latin_Small_Letter_E': 0x0364,
  'U_Combining_Latin_Small_Letter_I': 0x0365,
  'U_Combining_Latin_Small_Letter_O': 0x0366,
  'U_Combining_Latin_Small_Letter_U': 0x0367,
  'U_Combining_Latin_Small_Letter_C': 0x0368,
  'U_Combining_Latin_Small_Letter_D': 0x0369,
  'U_Combining_Latin_Small_Letter_H': 0x036A,
  'U_Combining_Latin_Small_Letter_M': 0x036B,
  'U_Combining_Latin_Small_Letter_R': 0x036C,
  'U_Combining_Latin_Small_Letter_T': 0x036D,
  'U_Combining_Latin_Small_Letter_V': 0x036E,
  'U_Combining_Latin_Small_Letter_X': 0x036F,
  'LINE_SEPARATOR_2028': 8232,
  'U_DIAERESIS': 0x00A8,
  'U_MACRON': 0x00AF,
  'U_ACUTE_ACCENT': 0x00B4,
  'U_CEDILLA': 0x00B8,
  'U_MODIFIER_LETTER_LEFT_ARROWHEAD': 0x02C2,
  'U_MODIFIER_LETTER_RIGHT_ARROWHEAD': 0x02C3,
  'U_MODIFIER_LETTER_UP_ARROWHEAD': 0x02C4,
  'U_MODIFIER_LETTER_DOWN_ARROWHEAD': 0x02C5,
  'U_MODIFIER_LETTER_CENTRED_RIGHT_HALF_RING': 0x02D2,
  'U_MODIFIER_LETTER_CENTRED_LEFT_HALF_RING': 0x02D3,
  'U_MODIFIER_LETTER_UP_TACK': 0x02D4,
  'U_MODIFIER_LETTER_DOWN_TACK': 0x02D5,
  'U_MODIFIER_LETTER_PLUS_SIGN': 0x02D6,
  'U_MODIFIER_LETTER_MINUS_SIGN': 0x02D7,
  'U_BREVE': 0x02D8,
  'U_DOT_ABOVE': 0x02D9,
  'U_RING_ABOVE': 0x02DA,
  'U_OGONEK': 0x02DB,
  'U_SMALL_TILDE': 0x02DC,
  'U_DOUBLE_ACUTE_ACCENT': 0x02DD,
  'U_MODIFIER_LETTER_RHOTIC_HOOK': 0x02DE,
  'U_MODIFIER_LETTER_CROSS_ACCENT': 0x02DF,
  'U_MODIFIER_LETTER_EXTRA_HIGH_TONE_BAR': 0x02E5,
  'U_MODIFIER_LETTER_HIGH_TONE_BAR': 0x02E6,
  'U_MODIFIER_LETTER_MID_TONE_BAR': 0x02E7,
  'U_MODIFIER_LETTER_LOW_TONE_BAR': 0x02E8,
  'U_MODIFIER_LETTER_EXTRA_LOW_TONE_BAR': 0x02E9,
  'U_MODIFIER_LETTER_YIN_DEPARTING_TONE_MARK': 0x02EA,
  'U_MODIFIER_LETTER_YANG_DEPARTING_TONE_MARK': 0x02EB,
  'U_MODIFIER_LETTER_UNASPIRATED': 0x02ED,
  'U_MODIFIER_LETTER_LOW_DOWN_ARROWHEAD': 0x02EF,
  'U_MODIFIER_LETTER_LOW_UP_ARROWHEAD': 0x02F0,
  'U_MODIFIER_LETTER_LOW_LEFT_ARROWHEAD': 0x02F1,
  'U_MODIFIER_LETTER_LOW_RIGHT_ARROWHEAD': 0x02F2,
  'U_MODIFIER_LETTER_LOW_RING': 0x02F3,
  'U_MODIFIER_LETTER_MIDDLE_GRAVE_ACCENT': 0x02F4,
  'U_MODIFIER_LETTER_MIDDLE_DOUBLE_GRAVE_ACCENT': 0x02F5,
  'U_MODIFIER_LETTER_MIDDLE_DOUBLE_ACUTE_ACCENT': 0x02F6,
  'U_MODIFIER_LETTER_LOW_TILDE': 0x02F7,
  'U_MODIFIER_LETTER_RAISED_COLON': 0x02F8,
  'U_MODIFIER_LETTER_BEGIN_HIGH_TONE': 0x02F9,
  'U_MODIFIER_LETTER_END_HIGH_TONE': 0x02FA,
  'U_MODIFIER_LETTER_BEGIN_LOW_TONE': 0x02FB,
  'U_MODIFIER_LETTER_END_LOW_TONE': 0x02FC,
  'U_MODIFIER_LETTER_SHELF': 0x02FD,
  'U_MODIFIER_LETTER_OPEN_SHELF': 0x02FE,
  'U_MODIFIER_LETTER_LOW_LEFT_ARROW': 0x02FF,
  'U_GREEK_LOWER_NUMERAL_SIGN': 0x0375,
  'U_GREEK_TONOS': 0x0384,
  'U_GREEK_DIALYTIKA_TONOS': 0x0385,
  'U_GREEK_KORONIS': 0x1FBD,
  'U_GREEK_PSILI': 0x1FBF,
  'U_GREEK_PERISPOMENI': 0x1FC0,
  'U_GREEK_DIALYTIKA_AND_PERISPOMENI': 0x1FC1,
  'U_GREEK_PSILI_AND_VARIA': 0x1FCD,
  'U_GREEK_PSILI_AND_OXIA': 0x1FCE,
  'U_GREEK_PSILI_AND_PERISPOMENI': 0x1FCF,
  'U_GREEK_DASIA_AND_VARIA': 0x1FDD,
  'U_GREEK_DASIA_AND_OXIA': 0x1FDE,
  'U_GREEK_DASIA_AND_PERISPOMENI': 0x1FDF,
  'U_GREEK_DIALYTIKA_AND_VARIA': 0x1FED,
  'U_GREEK_DIALYTIKA_AND_OXIA': 0x1FEE,
  'U_GREEK_VARIA': 0x1FEF,
  'U_GREEK_OXIA': 0x1FFD,
  'U_GREEK_DASIA': 0x1FFE,
  'U_OVERLINE': 0x203E,
  'UTF8_BOM': 65279,
  }
  const codes = (charCodes as unknown as Record<string, Record<string, number>>).CharCode
  const names = Object.keys(expected)
  for (const name of names) {
    assert.strictEqual(codes[name], expected[name], name)
  }
  // The runtime enum object also carries a reverse numeric key per member;
  // matching total counts proves every property is covered by the table.
  assert.strictEqual(Object.keys(codes).length, names.length * 2)
})
