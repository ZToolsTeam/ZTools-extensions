/**
 * ZTools 极简计算器核心引擎 (纯函数、无 eval、无外部依赖)
 */

export interface EvalResult {
  success: boolean;
  value?: number;
  formatted?: string;
  error?: string;
}

export interface HistoryItem {
  id: string;
  expression: string;
  result: string;
  timestamp: number;
}

/**
 * 格式化输出数字，消除浮点数微小误差，过大或过小采用科学计数法
 */
export function formatResultNumber(num: number): string {
  if (isNaN(num)) return "NaN";
  if (!isFinite(num)) return num > 0 ? "Infinity" : "-Infinity";

  // 消除浮点数舍入微小误差 (如 0.1 + 0.2 = 0.30000000000000004)
  const precisionFixed = parseFloat(num.toPrecision(12));

  // 超大或超小数值
  if (Math.abs(precisionFixed) >= 1e12 || (Math.abs(precisionFixed) < 1e-6 && precisionFixed !== 0)) {
    return precisionFixed.toExponential(6).replace(/\.?0+e/, "e");
  }

  return String(precisionFixed);
}

/**
 * 词法分析 Token 类型
 */
type TokenType = "NUMBER" | "OP" | "LPAREN" | "RPAREN" | "FUNC" | "COMMA";

interface Token {
  type: TokenType;
  value: string;
}

/**
 * 词法分析器 (Token Parser)
 */
export function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = expr.trim();

  while (i < s.length) {
    const ch = s[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // 数字与浮点数
    if (/\d/.test(ch) || (ch === "." && i + 1 < s.length && /\d/.test(s[i + 1]))) {
      let numStr = "";
      while (i < s.length && (/[\d.]/.test(s[i]) || (s[i].toLowerCase() === "e" && /[\d+-]/.test(s[i + 1] || "")))) {
        numStr += s[i];
        if (s[i].toLowerCase() === "e" && (s[i + 1] === "+" || s[i + 1] === "-")) {
          i++;
          numStr += s[i];
        }
        i++;
      }
      tokens.push({ type: "NUMBER", value: numStr });
      continue;
    }

    // 括号
    if (ch === "(") {
      tokens.push({ type: "LPAREN", value: "(" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "RPAREN", value: ")" });
      i++;
      continue;
    }

    // 逗号
    if (ch === ",") {
      tokens.push({ type: "COMMA", value: "," });
      i++;
      continue;
    }

    // 操作符
    if (["+", "-", "*", "/", "%", "^"].includes(ch)) {
      tokens.push({ type: "OP", value: ch });
      i++;
      continue;
    }

    // 字母标识符 (函数名或常量，如 sin, cos, sqrt, pi, e)
    if (/[a-zA-Z]/.test(ch)) {
      let idStr = "";
      while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) {
        idStr += s[i];
        i++;
      }
      const lower = idStr.toLowerCase();
      if (lower === "pi") {
        tokens.push({ type: "NUMBER", value: String(Math.PI) });
      } else if (lower === "e") {
        tokens.push({ type: "NUMBER", value: String(Math.E) });
      } else {
        tokens.push({ type: "FUNC", value: lower });
      }
      continue;
    }

    throw new Error(`无法识别的字符: "${ch}"`);
  }

  return tokens;
}

/**
 * 递归下降语法解析器与求值器
 */
export class MathParser {
  private tokens: Token[] = [];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consume(): Token {
    return this.tokens[this.pos++];
  }

  public parse(): number {
    if (this.tokens.length === 0) return 0;
    const res = this.parseExpression();
    if (this.pos < this.tokens.length) {
      throw new Error(`非法的表达式结尾: "${this.tokens[this.pos].value}"`);
    }
    return res;
  }

  // Expression: Term (('+' | '-') Term)*
  private parseExpression(): number {
    let left = this.parseTerm();

    while (this.pos < this.tokens.length) {
      const token = this.peek();
      if (token && token.type === "OP" && (token.value === "+" || token.value === "-")) {
        this.consume();
        const right = this.parseTerm();
        left = token.value === "+" ? left + right : left - right;
      } else {
        break;
      }
    }

    return left;
  }

  // Term: Power (('*' | '/' | '%') Power)*
  private parseTerm(): number {
    let left = this.parsePower();

    while (this.pos < this.tokens.length) {
      const token = this.peek();
      if (token && token.type === "OP" && (token.value === "*" || token.value === "/" || token.value === "%")) {
        this.consume();
        const right = this.parsePower();
        if (token.value === "*") {
          left = left * right;
        } else if (token.value === "/") {
          if (right === 0) throw new Error("除数不能为0");
          left = left / right;
        } else {
          if (right === 0) throw new Error("模运算除数不能为0");
          left = left % right;
        }
      } else {
        break;
      }
    }

    return left;
  }

  // Power: Factor ('^' Factor)* (右结合)
  private parsePower(): number {
    const left = this.parseFactor();

    const token = this.peek();
    if (token && token.type === "OP" && token.value === "^") {
      this.consume();
      const right = this.parsePower();
      return Math.pow(left, right);
    }

    return left;
  }

  // Factor: Unary | Number | Parentheses | Function
  private parseFactor(): number {
    const token = this.peek();
    if (!token) throw new Error("表达式不完整，缺少操作数");

    // 一元正负号
    if (token.type === "OP" && (token.value === "+" || token.value === "-")) {
      this.consume();
      const factor = this.parseFactor();
      return token.value === "+" ? factor : -factor;
    }

    // 数字
    if (token.type === "NUMBER") {
      this.consume();
      const val = parseFloat(token.value);
      if (isNaN(val)) throw new Error(`无效的数字: "${token.value}"`);
      return val;
    }

    // 括号
    if (token.type === "LPAREN") {
      this.consume(); // (
      const val = this.parseExpression();
      const next = this.peek();
      if (!next || next.type !== "RPAREN") {
        throw new Error("缺少匹配的右括号 ')'");
      }
      this.consume(); // )
      return val;
    }

    // 函数调用
    if (token.type === "FUNC") {
      const funcName = token.value;
      this.consume();
      const next = this.peek();
      if (!next || next.type !== "LPAREN") {
        throw new Error(`函数 "${funcName}" 后应紧随括号 '('`);
      }
      this.consume(); // (
      const arg = this.parseExpression();
      const endParen = this.peek();
      if (!endParen || endParen.type !== "RPAREN") {
        throw new Error(`函数 "${funcName}" 缺少闭合右括号 ')'`);
      }
      this.consume(); // )

      switch (funcName) {
        case "sqrt":
          if (arg < 0) throw new Error("不能对负数开平方");
          return Math.sqrt(arg);
        case "cbrt":
          return Math.cbrt(arg);
        case "abs":
          return Math.abs(arg);
        case "sin":
          return Math.sin((arg * Math.PI) / 180); // 默认角度
        case "cos":
          return Math.cos((arg * Math.PI) / 180);
        case "tan": {
          const rad = (arg * Math.PI) / 180;
          const val = Math.tan(rad);
          if (Math.abs(val) > 1e15) throw new Error("正切值超出计算极值");
          return val;
        }
        case "log":
        case "log10":
          if (arg <= 0) throw new Error("对数真数必须大于0");
          return Math.log10(arg);
        case "ln":
          if (arg <= 0) throw new Error("自然对数真数必须大于0");
          return Math.log(arg);
        case "log2":
          if (arg <= 0) throw new Error("以2为底对数真数必须大于0");
          return Math.log2(arg);
        case "floor":
          return Math.floor(arg);
        case "ceil":
          return Math.ceil(arg);
        case "round":
          return Math.round(arg);
        default:
          throw new Error(`未知的数学函数: "${funcName}"`);
      }
    }

    throw new Error(`无法解析的语法单元: "${token.value}"`);
  }
}

/**
 * 执行表达式安全求值主函数
 */
export function evaluateExpression(expr: string): EvalResult {
  const cleaned = (expr || "").trim();
  if (!cleaned) {
    return { success: false, error: "请输入数学表达式" };
  }

  try {
    const tokens = tokenize(cleaned);
    const parser = new MathParser(tokens);
    const val = parser.parse();

    if (!isFinite(val) || isNaN(val)) {
      return { success: false, error: "计算结果溢出或无意义" };
    }

    return {
      success: true,
      value: val,
      formatted: formatResultNumber(val)
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "算式语法错误"
    };
  }
}
