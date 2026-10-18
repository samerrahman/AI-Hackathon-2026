/** Keep spoken content faithful while preventing StepFun's parentheses-as-directions syntax. */
export function prepareSpeechText(value: string): string {
  let text = value
    .replace(/\[([^\]]+)\]\([^\n)]*\)/g, '$1')
    .replace(/\*\*|__|`|\$\$?/g, '')
    .replace(/\\[()[\]]/g, '')
    .replace(/\\(?:left|right)\b/g, '')
    .replace(/\\(?:text|mathrm|operatorname)\{([^{}]*)\}/g, '$1');
  // Preserve grouping explicitly. Nested expressions are resolved from the inside out.
  for (let pass = 0; pass < 8; pass++) {
    const next = text
      .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, ' fraction, numerator $1, denominator $2, end fraction ')
      .replace(/\\sqrt\{([^{}]*)\}/g, ' square root of $1, end root ')
      .replace(/\^\{([^{}]*)\}/g, ' to the power of $1, end exponent ')
      .replace(/_\{([^{}]*)\}/g, ' subscript $1, end subscript ');
    if (next === text) break;
    text = next;
  }
  const names: Record<string, string> = {
    forall: 'for every', exists: 'there exists', epsilon: 'epsilon', varepsilon: 'epsilon', delta: 'delta',
    alpha: 'alpha', beta: 'beta', gamma: 'gamma', lambda: 'lambda', theta: 'theta', sigma: 'sigma', pi: 'pi',
    infty: 'infinity', in: 'belongs to', notin: 'does not belong to', subset: 'is a subset of', subseteq: 'is a subset of or equal to',
    le: 'less than or equal to', leq: 'less than or equal to', ge: 'greater than or equal to', geq: 'greater than or equal to',
    ne: 'not equal to', neq: 'not equal to', approx: 'approximately equals', to: 'tends to', implies: 'implies', iff: 'if and only if',
    times: 'times', cdot: 'times', pm: 'plus or minus', land: 'and', lor: 'or', neg: 'not', lim: 'limit', sum: 'sum', int: 'integral',
  };
  text = text.replace(/\\([A-Za-z]+)/g, (_whole, name: string) => ` ${names[name] ?? name} `)
    .replace(/\^([+-]?(?:\d+(?:\.\d+)?|[A-Za-z]))/g, ' to the power of $1')
    .replace(/([A-Za-z0-9])_([A-Za-z0-9])/g, '$1 subscript $2')
    .replace(/\s-\s/g, ' minus ');
  const symbols: Record<string, string> = {
    'ε': 'epsilon', 'δ': 'delta', 'α': 'alpha', 'β': 'beta', 'θ': 'theta', 'λ': 'lambda', 'π': 'pi', '∞': 'infinity',
    '∀': 'for every', '∃': 'there exists', '∈': 'belongs to', '∉': 'does not belong to', '≤': 'less than or equal to',
    '≥': 'greater than or equal to', '≠': 'not equal to', '≈': 'approximately equals', '→': 'tends to', '⇒': 'implies',
    '⇔': 'if and only if', '±': 'plus or minus', '×': 'times', '·': 'times', '−': 'minus', '²': 'squared', '³': 'cubed',
    '(': 'open parenthesis', ')': 'close parenthesis', '（': 'open parenthesis', '）': 'close parenthesis', '{': 'open brace', '}': 'close brace', '[': 'open bracket', ']': 'close bracket',
    '<': 'less than', '>': 'greater than', '=': 'equals', '+': 'plus', '|': 'vertical bar',
  };
  return text
    .replace(/<=/g, ' less than or equal to ').replace(/>=/g, ' greater than or equal to ').replace(/!=/g, ' not equal to ')
    .replace(/[εδαβθλπ∞∀∃∈∉≤≥≠≈→⇒⇔±×·−²³()（）{}\[\]<>=+|]/g, symbol => ` ${symbols[symbol]} `)
    .replace(/(^|\s)-(\d|[A-Za-z]\b)/g, '$1minus $2')
    .replace(/\bN\b/g, 'capital N')
    .replace(/\s+/g, ' ').trim();
}
