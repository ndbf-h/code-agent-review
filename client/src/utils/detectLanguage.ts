/**
 * 代码语言自动识别
 *
 * 基于特征模式匹配的启发式检测。每种语言定义一组独有的特征模式
 * 和一组加分模式，按累计得分最高的语言返回识别结果。
 *
 * 仅当最高分 >= 最低阈值且领先第二名 >= 领先阈值时才算"确认识别"，
 * 否则返回 null 表示不确定，前端应保持当前语言选择不变。
 */

interface LanguagePattern {
  /** 该语言独有的标志性特征（权重高），匹配一个得 3 分 */
  signatures: RegExp[]
  /** 辅助特征（权重低），匹配一个得 1 分 */
  hints: RegExp[]
}

const PATTERNS: Record<string, LanguagePattern> = {
  typescript: {
    signatures: [
      /\binterface\s+\w+/,
      /\btype\s+\w+\s*=/,
      /:\s*(string|number|boolean|void|any|never|unknown|bigint)\b/,
      /\benum\s+\w+/,
      /\bas\s+(string|number|boolean)\b/,
      /\bReadonlyArray\b|\bPartial\b|\bRequired\b|\bPick\b|\bOmit\b/
    ],
    hints: [
      /\bconst\s+\w+/,
      /\blet\s+\w+/,
      /\bimport\s+\{/,
      /\bexport\s+(default\s+)?(class|function|const|interface|type)\b/,
      /=>\s*\{/,
      /\.tsx?\b/
    ]
  },
  java: {
    signatures: [
      /\bpublic\s+(static\s+)?(void|class|int|String|boolean)\b/,
      /@(Override|Autowired|Service|Component|Repository|Controller)\b/,
      /import\s+java\./,
      /\bSystem\.out\./,
      /\bclass\s+\w+\s+extends\b/,
      /\bprivate\s+(static\s+)?final\b/
    ],
    hints: [
      /\bpublic\s+class\b/,
      /\bString\[\]\s+args\b/,
      /\.equals\(/,
      /\bHashMap\b|\bArrayList\b|\bLinkedList\b/,
      /\bnew\s+\w+\(/,
      /;\s*$/m
    ]
  },
  python: {
    signatures: [
      /\bdef\s+\w+\s*\(/,
      /\bimport\s+(os|sys|re|json|datetime|collections|itertools)\b/,
      /\bprint\(/,
      /\bself\.\w+/,
      /:\s*$/m,
      /\b__init__\b|\b__name__\b|\b__main__\b/
    ],
    hints: [
      /\bclass\s+\w+:/,
      /\bfrom\s+\w+\s+import\b/,
      /^\s*#.*$/m,
      /\bNone\b|\bTrue\b|\bFalse\b/,
      /\bif\s+__name__\b/,
      /\braise\s+\w+/
    ]
  },
  javascript: {
    signatures: [
      /\bconsole\.(log|error|warn|info)\b/,
      /\bdocument\.(getElementById|querySelector)\b/,
      /\bwindow\.\w+/,
      /\brequire\(/,
      /\bmodule\.exports\b/,
      /\baddEventListener\(/
    ],
    hints: [
      /\bfunction\s+\w+\s*\(/,
      /\bconst\s+\w+/,
      /\blet\s+\w+/,
      /\bvar\s+\w+/,
      /=>\s*\{/,
      /\$\{.*\}/
    ]
  },
  go: {
    signatures: [
      /\bpackage\s+main\b/,
      /\bfunc\s+\w+\s*\(.*\)\s*(\w+|\{)/,
      /\bfmt\.(Print|Sprintf|Errorf)\b/,
      /\bgo\s+func\b/,
      /\bdefer\s+\w+/,
      /\bvar\s+\w+\s+\w+\s*=\s*/
    ],
    hints: [
      /:=/,
      /\berr\s*!=\s*nil\b/,
      /\bif\s+err\s*!=\s*nil\b/,
      /\bimport\s+\(\s*$/m,
      /\bstring\b|\bint\b|\bbool\b|\bfloat64\b|\berror\b/,
      /\*?\w+Error\b/
    ]
  },
  rust: {
    signatures: [
      /\bfn\s+\w+\s*\(/,
      /\blet\s+mut\b/,
      /\bimpl\s+\w+/,
      /::\w+/,
      /\bprintln!\(/,
      /\buse\s+\w+::/
    ],
    hints: [
      /\bpub\s+(fn|struct|enum)\b/,
      /\bString\b|\bVec\b|\bOption\b|\bResult\b|\bSome\b|\bNone\b/,
      /\bmatch\s+\w+\s*\{/,
      /\bstruct\s+\w+\s*\{/,
      /\b&self\b|\b&mut\s+self\b/,
      /\b\w+!\(/
    ]
  },
  ruby: {
    signatures: [
      /^\s*def\s+\w+/m,
      /\brequire\s+['"]\w+['"]/,
      /\battr_accessor\b|\battr_reader\b|\battr_writer\b/,
      /\bclass\s+\w+\s*<\s*\w+/,
      /do\s+\|.*\|/
    ],
    hints: [/\bend\s*$/m, /\bputs\b/, /#\{.*\}/, /\bmodule\s+\w+/, /\bnil\b/, /\.each\s+do\b/]
  },
  cpp: {
    signatures: [
      /#include\s*<.*>/,
      /\bstd::\w+/,
      /\bcout\s*<</,
      /\bcin\s*>>/,
      /\bvector\s*</,
      /\bnamespace\s+\w+/
    ],
    hints: [
      /\bint\s+main\b/,
      /\bclass\s+\w+\s*\{/,
      /->\w+/,
      /::\w+/,
      /\bvirtual\b|\boverride\b/,
      /\btemplate\s*</
    ]
  },
  c: {
    signatures: [
      /#include\s*<.*\.h>/,
      /\bprintf\(/,
      /\bscanf\(/,
      /\bmalloc\(|\bcalloc\(|\bfree\(/,
      /\bsizeof\(/,
      /\btypedef\s+struct\b/
    ],
    hints: [/\bint\s+main\b/, /%d\b|%s\b|%f\b|\n/, /\bNULL\b/, /\b(void)\b/]
  },
  css: {
    signatures: [
      /[.#][\w-]+\s*\{/,
      /:\s*\d+px\b/,
      /\bcolor\s*:\s*[#\w]/,
      /\bdisplay\s*:\s*(flex|grid|block|none|inline)\b/,
      /\b@media\b/
    ],
    hints: [
      /\bfont-size\b|\bfont-weight\b|\bmargin\b|\bpadding\b|\bborder\b|\bbackground\b/,
      /!important/,
      /@import/,
      /\brem\b|\bem\b|\bvh\b|\bvw\b/
    ]
  },
  html: {
    signatures: [
      /<!DOCTYPE\s+html>/i,
      /<\/?\w+[^>]*>/,
      /<html\b/i,
      /<head\b|<body\b/i,
      /<script\b|<style\b/i
    ],
    hints: [
      /<div\b|<span\b|<p\b|<a\s|<img\b|<input\b|<button\b/i,
      /class\s*=\s*"/,
      /id\s*=\s*"/,
      /href\s*=\s*"/
    ]
  },
  sql: {
    signatures: [
      /\bSELECT\b.+\bFROM\b/is,
      /\bINSERT\s+INTO\b/i,
      /\bCREATE\s+TABLE\b/i,
      /\bALTER\s+TABLE\b/i,
      /\bDROP\s+TABLE\b/i,
      /\bJOIN\b.+\bON\b/is
    ],
    hints: [
      /\bWHERE\b|\bGROUP\s+BY\b|\bORDER\s+BY\b|\bHAVING\b/i,
      /\bPRIMARY\s+KEY\b|\bFOREIGN\s+KEY\b/i,
      /\bVARCHAR\b|\bINTEGER\b|\bBOOLEAN\b|\bTIMESTAMP\b/i
    ]
  },
  shell: {
    signatures: [
      /^#!\/bin\/(ba)?sh\b/m,
      /^#!\/usr\/bin\/env\s+\w+/m,
      /\bexport\s+\w+=/,
      /\$\{?\w+\}?/
    ],
    hints: [/\becho\b/, /\bif\s+\[\s+/, /\bthen\b|\bfi\b/, /\bdone\b/, /\b\w+=\$\(/]
  },
  swift: {
    signatures: [
      /\bimport\s+Foundation\b/,
      /\bfunc\s+\w+\s*\([^)]*\)\s*->\s*\w+/,
      /\bvar\s+\w+\s*:\s*\w+/,
      /\blet\s+\w+\s*:\s*\w+/,
      /\bguard\s+\w+/
    ],
    hints: [
      /@IBAction\b|@IBOutlet\b/,
      /\boverride\s+func\b/,
      /\bclass\s+\w+\s*:\s*\w+/,
      /\bstruct\s+\w+\s*\{/,
      /\?\?\s*\w+/
    ]
  },
  kotlin: {
    signatures: [
      /\bfun\s+\w+\s*\(/,
      /\bval\s+\w+\s*[:=]/,
      /\bimport\s+kotlin\./,
      /\bdata\s+class\b/,
      /\bwhen\s*\(/
    ],
    hints: [
      /\bvar\s+\w+\s*[:=]/,
      /\?\?/,
      /\b!!\b|\?\s*\./,
      /\bcompanion\s+object\b/,
      /\bsealed\s+class\b/
    ]
  },
  php: {
    signatures: [/<\?php/, /\$\w+/, /\becho\s+/, /\bfunction\s+\w+\s*\(/, /\b\w+::\w+/],
    hints: [
      /\brequire\b|\brequire_once\b|\binclude\b|\binclude_once\b/,
      /\bnamespace\s+\w+/,
      /\buse\s+\w+\\\w+/,
      /\bpublic\s+function\b/,
      /\bprotected\s+\$/
    ]
  },
  csharp: {
    signatures: [
      /\busing\s+System\b/,
      /\bnamespace\s+\w+/,
      /\bclass\s+\w+\s*:\s*\w+/,
      /\bvar\s+\w+\s*=\s*new\b/,
      /\bstring\?\b/
    ],
    hints: [
      /\bpublic\s+class\b/,
      /\bprivate\s+void\b|\bpublic\s+void\b|\bprotected\s+void\b/,
      /\bConsole\.(Write|Read)/,
      /\bget\s*\{\s*set\s*;\s*\}/,
      /\basync\s+Task\b/
    ]
  }
}

/** 最低置信度阈值：最高分至少需要达到 */
const MIN_SCORE = 5
/** 领先阈值：最高分领先第二名至少 N 分才算确认 */
const LEAD_MARGIN = 3

export interface DetectionResult {
  language: string
  score: number
  /** 是否确认识别（高置信度） */
  confident: boolean
}

/**
 * 检测代码语言
 * @returns 识别结果。若 confident=false 表示不确定，调用方应保持当前语言不变
 */
export function detectLanguage(code: string): DetectionResult {
  if (!code || !code.trim()) {
    return { language: '', score: 0, confident: false }
  }

  const scores: [string, number][] = []

  for (const [lang, patterns] of Object.entries(PATTERNS)) {
    let score = 0
    for (const re of patterns.signatures) {
      if (re.test(code)) score += 3
    }
    for (const re of patterns.hints) {
      if (re.test(code)) score += 1
    }
    if (score > 0) {
      scores.push([lang, score])
    }
  }

  if (scores.length === 0) {
    return { language: '', score: 0, confident: false }
  }

  // 按得分降序排列
  scores.sort((a, b) => b[1] - a[1])

  const [best, second] = scores
  const confident = best[1] >= MIN_SCORE && (!second || best[1] - second[1] >= LEAD_MARGIN)

  return {
    language: best[0],
    score: best[1],
    confident
  }
}

/** 所有支持识别的语言列表 */
export const DETECTABLE_LANGUAGES = Object.keys(PATTERNS)
